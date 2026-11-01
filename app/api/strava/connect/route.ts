// https://developers.strava.com/docs/authentication/#requesting-access

import type { NextRequest } from "next/server";
import { cancelStravaAuthorization, connectStrava } from "@/lib/strava/oauth";
import { stravaErrorResponse } from "@/lib/strava/http";

export async function POST(request: NextRequest) {
  try {
    return await connectStrava(request);
  } catch (error) {
    return stravaErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    return await cancelStravaAuthorization(request);
  } catch (error) {
    return stravaErrorResponse(error);
  }
}
