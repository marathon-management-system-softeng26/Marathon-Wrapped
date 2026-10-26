// https://developers.strava.com/docs/authentication/#requesting-access

import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthenticationError } from "@/lib/auth/session";
import { createStravaAuthorizationUrl } from "@/lib/strava/client";

export async function GET(request: NextRequest) {

  try {
    const user = await requireUser();

    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url))
    }

    const callbackUri = new URL("/api/strava/callback", request.url);

    const oauth_uri = createStravaAuthorizationUrl(callbackUri.toString(), "some_state");
    if (!oauth_uri) {
      return NextResponse.json({ error: "Failed to create Strava authorization URL." }, { status: 500 });
    }
    return NextResponse.redirect(oauth_uri);

  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.redirect(new URL("/login", request.url))
    }
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }

}
