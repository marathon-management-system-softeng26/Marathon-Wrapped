// https://developers.strava.com/docs/webhooks/

import crypto from "node:crypto";
import {
  enqueueWebhookEvent,
  validateStravaWebhookEvent,
} from "@/lib/strava/processing";
import { StravaError } from "@/lib/strava/client";
import { stravaErrorResponse } from "@/lib/strava/http";
import { privateHeaders } from "@/lib/authHttp";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const configured = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  const supplied = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (!configured) {
    return stravaErrorResponse(new StravaError("webhook_not_configured"));
  }

  if (
    params.getAll("hub.mode").length !== 1 ||
    params.get("hub.mode") !== "subscribe" ||
    params.getAll("hub.verify_token").length !== 1 ||
    !supplied ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(configured) ||
    !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(configured)) ||
    params.getAll("hub.challenge").length !== 1 ||
    !challenge ||
    challenge.length > 1024
  ) {
    return stravaErrorResponse(new StravaError("invalid_verification", 403));
  }

  return Response.json({ "hub.challenge": challenge }, { headers: privateHeaders });
}

export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length")) > 16384) {
      throw new StravaError("webhook_too_large", 413);
    }

    const reader = request.body?.getReader();

    if (!reader) {
      throw new StravaError("invalid_webhook", 400);
    }

    const chunks: Uint8Array[] = [];
    let size = 0;

    try {
      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        size += value.byteLength;

        if (size > 16384) {
          throw new StravaError("webhook_too_large", 413);
        }

        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }

    let event: unknown;

    try {
      event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new StravaError("invalid_webhook", 400);
    }

    await enqueueWebhookEvent(validateStravaWebhookEvent(event));

    return new Response(null, { status: 200, headers: privateHeaders });
  } catch (error) {
    return stravaErrorResponse(error);
  }
}
