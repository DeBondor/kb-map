/**
 * Tiny in-memory per-IP token bucket for the upstream-forwarding routes, so the
 * open passthrough can't be turned into a flood/amplifier against the upstream
 * API. Limits are deliberately generous — the app's own bursts (e.g. a stop's
 * timetable fanning out one /api/trip per departure) pass; only sustained abuse
 * is throttled. In-memory is fine here: the server is a single long-lived Node
 * process (it owns the poller singleton), not a swarm of serverless instances.
 */
const CAP = 200; // burst capacity per IP
const REFILL_PER_SEC = 25; // sustained requests/sec per IP once the burst is spent

interface Bucket {
  tokens: number;
  last: number;
}
const buckets = new Map<string, Bucket>();

/** Best-effort client IP from the usual proxy headers. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "local";
}

/** true = allowed; false = over the limit (caller should return 429). */
export function allowRequest(ip: string): boolean {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) {
    b = { tokens: CAP, last: now };
    buckets.set(ip, b);
  } else {
    b.tokens = Math.min(CAP, b.tokens + ((now - b.last) / 1000) * REFILL_PER_SEC);
    b.last = now;
  }
  // opportunistic sweep so idle IPs don't accumulate in a long-lived process
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now - v.last > 60_000) buckets.delete(k);
  }
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/** 429 response with a Retry-After hint. */
export function tooManyRequests(): Response {
  return Response.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": "5" } },
  );
}
