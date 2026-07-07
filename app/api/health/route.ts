import { upstreamError } from "@/lib/api-helpers";
import { getPoller, startPoller } from "@/lib/poller-singleton";
import type { HealthResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/health — status + counters. */
export async function GET(): Promise<Response> {
  try {
    await startPoller();
    const poller = getPoller();
    const body: HealthResponse = {
      status: "ok",
      stops: poller.stops.length,
      scan_count: poller.scanCount,
      last_scan: poller.lastScan,
      vehicles: poller.liveCount(),
    };
    return Response.json(body);
  } catch (err) {
    return upstreamError("health", err);
  }
}
