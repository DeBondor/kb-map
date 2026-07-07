import { upstreamError } from "@/lib/api-helpers";
import { getPoller, startPoller } from "@/lib/poller-singleton";
import { getStopDirections } from "@/lib/stop-directions";
import type { StopsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/stops — all loaded stops, each with up to two GTFS-derived travel
 *  bearings (`dirs`) so the map can point the bus-stop icon the right way. */
export async function GET(): Promise<Response> {
  try {
    await startPoller();
    const poller = getPoller();
    const dirs = getStopDirections();
    const body: StopsResponse = {
      count: poller.stops.length,
      stops: poller.stops.map((s) => {
        const d = dirs.get(s.stopId);
        return {
          id: s.stopId,
          designator: s.urlId,
          name: s.name,
          lat: s.lat,
          lon: s.lon,
          ...(d && d.length ? { dirs: d } : {}),
        };
      }),
    };
    return Response.json(body, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (err) {
    return upstreamError("stops", err);
  }
}
