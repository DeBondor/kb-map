import { upstreamError } from "@/lib/api-helpers";
import { getPoller, startPoller } from "@/lib/poller-singleton";
import { getStopDirections } from "@/lib/stop-directions";
import type { Stop, StopsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The stop list only changes when the poller (re)loads it — `poller.stops` is
 *  reassigned wholesale, never mutated in place — and the directions map only
 *  when the nightly GTFS rebuild invalidates its cache, so the ~110 KB response
 *  body is serialized once per (stop list, directions) identity pair. */
let cached: { stops: Stop[]; dirs: Map<string, number[]>; body: string } | null = null;

/** GET /api/stops — all loaded stops, each with up to two GTFS-derived travel
 *  bearings (`dirs`) so the map can point the bus-stop icon the right way. */
export async function GET(): Promise<Response> {
  try {
    await startPoller();
    const poller = getPoller();
    const dirs = getStopDirections();
    if (!cached || cached.stops !== poller.stops || cached.dirs !== dirs) {
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
            ...(s.isStation ? { isStation: true } : {}),
            ...(s.showPlatforms ? { showPlatforms: true } : {}),
          };
        }),
      };
      cached = { stops: poller.stops, dirs, body: JSON.stringify(body) };
    }
    return new Response(cached.body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    return upstreamError("stops", err);
  }
}
