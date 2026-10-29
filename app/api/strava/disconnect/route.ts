// https://developers.strava.com/docs/authentication/#deauthorization

import { requireUser } from "@/lib/auth/session";
import { privateHeaders } from "@/lib/authHttp";
import { requireStravaOrigin, stravaErrorResponse } from "@/lib/strava/http";
import { disconnectStravaUser } from "@/lib/strava/processing";

export async function POST(request: Request) {
  try {
    requireStravaOrigin(request);

    const user = await requireUser();
    const status = await disconnectStravaUser(user.id);

    return Response.json(
      { status },
      {
        status: status === "disconnected" ? 200 : 202,
        headers: privateHeaders,
      },
    );
  } catch (error) {
    return stravaErrorResponse(error);
  }
}
