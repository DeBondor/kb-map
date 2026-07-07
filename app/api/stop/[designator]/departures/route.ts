import { badRequest, isValidId, upstreamError } from "@/lib/api-helpers";
import { pyTruthy } from "@/lib/kb-api";
import { getApi, startPoller } from "@/lib/poller-singleton";
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
    return Response.json(pyTruthy(data) ? data : {});
  } catch (err) {
    return upstreamError("departures", err);
  }
}
