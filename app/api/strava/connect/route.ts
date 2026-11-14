// https://developers.strava.com/docs/authentication/#requesting-access

import { NextRequest, NextResponse } from "next/server";
import { cancelStravaAuthorization, connectStrava } from "@/lib/strava/oauth";
import { stravaErrorResponse } from "@/lib/strava/http";
import { privateHeaders, sameOrigin } from "@/lib/authHttp";
import { isRunnerId } from "@/lib/runnerValidation";

export async function POST(request: NextRequest) {
  // Keep a native browser form on its recap if optional Strava setup/storage is
  // unavailable. The destination is reconstructed, never accepted from the form.
  const fallback = request.clone();
  try {
    return await connectStrava(request);
  } catch (error) {
    const response = stravaErrorResponse(error);
    if (response.status === 503 && sameOrigin(fallback) && fallback.headers.get("accept")?.includes("text/html")) {
      try {
        const values = (await fallback.formData()).getAll("runnerId");
        if (values.length === 1 && typeof values[0] === "string" && isRunnerId(values[0])) {
          return NextResponse.redirect(new URL(`/wrapped/${values[0].toLowerCase()}?strava=authorization_failed`, fallback.url),
            { status: 303, headers: { ...privateHeaders, "Referrer-Policy": "no-referrer" } });
        }
      } catch { /* Invalid form data still uses the normal private error. */ }
    }
    return response;
  }
}

export async function DELETE(request: NextRequest) {
  try {
    return await cancelStravaAuthorization(request);
  } catch (error) {
    return stravaErrorResponse(error);
  }
}
