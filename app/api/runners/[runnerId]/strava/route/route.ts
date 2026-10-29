// https://developers.strava.com/docs/reference/#api-Activities-getActivityById

import { requireUser } from "@/lib/auth/session";
import { privateHeaders } from "@/lib/authHttp";
import { requireStravaOrigin, stravaErrorResponse } from "@/lib/strava/http";
import { confirmRunnerStravaActivity, getRunnerStravaRoute } from "@/lib/strava/processing";

type RouteContext = { params: Promise<{ runnerId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();

    return Response.json(
      await getRunnerStravaRoute(user.id, (await context.params).runnerId),
      { headers: privateHeaders },
    );
  } catch (error) {
    return stravaErrorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    requireStravaOrigin(request);

    const user = await requireUser();
    await getRunnerStravaRoute(user.id, (await context.params).runnerId);
    await confirmRunnerStravaActivity();
  } catch (error) {
    return stravaErrorResponse(error);
  }
}
