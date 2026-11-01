// https://developers.strava.com/docs/webhooks/
// https://developers.strava.com/docs/rate-limits/

import crypto from "node:crypto";
import { privateHeaders } from "@/lib/authHttp";
import { processStravaJobs } from "@/lib/strava/processing";
import { StravaError } from "@/lib/strava/client";
import { stravaErrorResponse } from "@/lib/strava/http";

export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.STRAVA_PROCESS_SECRET;
  const supplied = request.headers.get("authorization") ?? "";

  if (!secret) {
    return stravaErrorResponse(new StravaError("worker_not_configured"));
  }

  const expected = `Bearer ${secret}`;

  if (
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    return stravaErrorResponse(new StravaError("unauthorized", 401));
  }

  try {
    await processStravaJobs();

    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch (error) {
    return stravaErrorResponse(error);
  }
}
