import { requireUser } from "@/lib/auth/session";
import { privateHeaders } from "@/lib/authHttp";
import { requireStravaOrigin, stravaErrorResponse } from "@/lib/strava/http";
import { attachRunnerToStrava } from "@/lib/strava/processing";

export async function POST(request: Request, context: { params: Promise<{ runnerId: string }> }) {
  try {
    requireStravaOrigin(request);
    const user = await requireUser();
    return Response.json(await attachRunnerToStrava(user.id, (await context.params).runnerId), { headers: privateHeaders });
  } catch (error) {
    return stravaErrorResponse(error);
  }
}
