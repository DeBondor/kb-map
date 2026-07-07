import { upstreamError } from "@/lib/api-helpers";
import { pyTruthy } from "@/lib/kb-api";
import { getApi, startPoller } from "@/lib/poller-singleton";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/announcements — upstream announcements passthrough. */
export async function GET(req: Request): Promise<Response> {
  if (!allowRequest(clientIp(req))) return tooManyRequests();
  try {
    await startPoller();
    const data = await getApi().fetchAnnouncements();
    return Response.json(pyTruthy(data) ? data : {});
  } catch (err) {
    return upstreamError("announcements", err);
  }
}
