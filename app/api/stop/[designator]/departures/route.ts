import { badRequest, isValidId, upstreamError } from "@/lib/api-helpers";
import { pyTruthy } from "@/lib/kb-api";
import { getApi, getPoller, startPoller } from "@/lib/poller-singleton";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/stop/[designator]/departures — upstream departures passthrough. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ designator: string }> },
): Promise<Response> {
  if (!allowRequest(clientIp(req))) return tooManyRequests();
  const { designator } = await ctx.params;
  if (!isValidId(designator)) return badRequest("Invalid stop designator");
  try {
    await startPoller();
    const data = await getApi().fetchDepartures(designator);
    if (pyTruthy(data) && typeof data === "object" && data !== null) {
      const rec = data as { rows?: Array<{ trip_execution_id?: string }> };
      if (Array.isArray(rec.rows)) {
        const eids = rec.rows
          .map((r) => r?.trip_execution_id)
          .filter((eid): eid is string => Boolean(eid));
        if (eids.length > 0) {
          getPoller().addCandidates(eids);
        }
      }
    }
    return Response.json(pyTruthy(data) ? data : {}, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (err) {
    return upstreamError("departures", err);
  }
}
