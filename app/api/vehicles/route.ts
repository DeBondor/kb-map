import { upstreamError } from "@/lib/api-helpers";
import { getPoller, startPoller } from "@/lib/poller-singleton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/vehicles — live vehicle positions as JSON. */
export async function GET(): Promise<Response> {
  try {
    await startPoller();
    return Response.json(getPoller().toJson());
  } catch (err) {
    return upstreamError("vehicles", err);
  }
}
