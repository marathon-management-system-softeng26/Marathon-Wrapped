// https://developers.strava.com/docs/authentication/#token-exchange

import type { NextRequest } from "next/server";
import { finishStravaAuthorization } from "@/lib/strava/oauth";
import { stravaErrorResponse } from "@/lib/strava/http";

export async function GET(request: NextRequest) {
  try {
    return await finishStravaAuthorization(request);
  } catch (error) {
    return stravaErrorResponse(error);
  }
}
