import { badRequest, isValidDate, isValidId, upstreamError } from "@/lib/api-helpers";
import { todayLocalISO } from "@/lib/config";
import { pyTruthy } from "@/lib/kb-api";
import { getApi, startPoller } from "@/lib/poller-singleton";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/stop/[designator]/timetable?date=YYYY-MM-DD — upstream timetable passthrough. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ designator: string }> },
): Promise<Response> {
  if (!allowRequest(clientIp(req))) return tooManyRequests();
  const { designator } = await ctx.params;
  if (!isValidId(designator)) return badRequest("Invalid stop designator");
  const date = new URL(req.url).searchParams.get("date") || todayLocalISO();
  if (!isValidDate(date)) return badRequest("date must be YYYY-MM-DD");
  try {
    await startPoller();
    const data = await getApi().fetchTimetable(designator, date);
    return Response.json(pyTruthy(data) ? data : {}, {
      headers: { "Cache-Control": "public, max-age=900" },
    });
  } catch (err) {
    return upstreamError("timetable", err);
  }
}
