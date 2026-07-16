import { getLines } from "@/lib/lines";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/lines — the static GTFS line catalog (route_short_name + terminus).
 *  Local file read (no upstream, no params), so no rate limit / id validation;
 *  the catalog only changes on a GTFS rebuild + redeploy, hence the long cache. */
export async function GET(): Promise<Response> {
  try {
    const lines = getLines();
    return Response.json(
      { count: lines.length, lines },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  } catch {
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
