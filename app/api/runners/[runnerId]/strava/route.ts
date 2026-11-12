import { requireUser } from "@/lib/auth/session";
import { privateHeaders } from "@/lib/authHttp";
import { StravaError } from "@/lib/strava/client";
import { requireStravaOrigin, stravaErrorResponse } from "@/lib/strava/http";
import { confirmRunnerStravaActivity, getRunnerStravaRoute } from "@/lib/strava/processing";

type RouteContext = { params: Promise<{ runnerId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    return Response.json(await getRunnerStravaRoute(user.id, (await context.params).runnerId), { headers: privateHeaders });
  } catch (error) {
    return stravaErrorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    requireStravaOrigin(request);
    const user = await requireUser();
    let body: unknown;
    try { body = await request.json(); } catch { throw new StravaError("invalid_activity", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof (body as Record<string, unknown>).activityId !== "string") throw new StravaError("invalid_activity", 400);
    return Response.json(await confirmRunnerStravaActivity(user.id, (await context.params).runnerId,
      (body as { activityId: string }).activityId), { headers: privateHeaders });
  } catch (error) {
    return stravaErrorResponse(error);
  }
}
