/**
 * Small shared helpers for the API routes: input validation for values that get
 * forwarded into upstream URLs, and error responses that don't leak internals.
 */
import { log } from "./logger";

/** Upstream-safe id: letters/digits and ':' '.' '_' '-' only, so the value can
 *  never smuggle a '/', '?', '#', '&' or '%' that would rewrite the upstream URL
 *  path/query. Matches real designators/trip ids (e.g. "19223", "19132:39688"). */
const ID_RE = /^[A-Za-z0-9:._-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidId(v: string): boolean {
  return ID_RE.test(v);
}

export function isValidDate(v: string): boolean {
  return DATE_RE.test(v);
}

/** 400 for a malformed path/query value. */
export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

/** 502 that logs the real error server-side but returns a generic message —
 *  never leaks the upstream base URL / request path or raw exception text. */
export function upstreamError(tag: string, err: unknown): Response {
  log.error(tag, err instanceof Error ? err.message : String(err));
  return Response.json({ error: "Upstream request failed" }, { status: 502 });
}
