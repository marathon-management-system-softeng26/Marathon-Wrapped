import { requireUser } from "@/lib/auth/session";
import { privateHeaders } from "@/lib/authHttp";
import { requireStravaOrigin, stravaErrorResponse } from "@/lib/strava/http";
import { detachRunnerFromStrava } from "@/lib/strava/processing";

export async function POST(request: Request, context: { params: Promise<{ runnerId: string }> }) {
  try {
    requireStravaOrigin(request);
    const user = await requireUser();
    const status = await detachRunnerFromStrava(user.id, (await context.params).runnerId);
    return Response.json({ status }, { headers: privateHeaders });
  } catch (error) {
    return stravaErrorResponse(error);
  }
}
