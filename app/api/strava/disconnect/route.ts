// https://developers.strava.com/docs/authentication/#deauthorization

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireUser, AuthenticationError } from "@/lib/auth/session";
import { getUserStravaAccessToken } from "@/lib/strava/client";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export async function POST(request: NextRequest) {

  try {
    const user = await requireUser();

    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url))
    }

    const accessToken = await getUserStravaAccessToken(user.id); // Implement this function to retrieve the user's Strava access token from your database

    if (!accessToken) {
      return NextResponse.json({ error: "No Strava access token found for user." }, { status: 400 });
    }

    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return NextResponse.json({ error: "Strava is not configured." }, { status: 500 });
    }

    const deauth_uri = "https://www.strava.com/oauth/revoke"

    const response = await fetch(deauth_uri, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ token: accessToken, token_type_hint: "access_token" }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Failed to revoke Strava access." }, { status: 500 });
    }

    // Remove the user's Strava tokens from your database
    const { error: deleteError } = await getSupabaseAdmin().from("strava_connections")
      .delete()
      .eq("user_id", user.id);

    if (deleteError) {
      return NextResponse.json({ error: "Failed to remove Strava tokens from database." }, { status: 500 });
    }

    return NextResponse.json({ message: "Successfully disconnected from Strava." }, { status: 200 });

  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.redirect(new URL("/login", request.url))
    }
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }

}
