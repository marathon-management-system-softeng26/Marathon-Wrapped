import "server-only";
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../auth/session";
import { privateHeaders } from "../authHttp";
import {
  createStravaAuthorizationUrl,
  exchangeAuthorizationCode,
  loadStravaConnection,
  saveStravaConnection,
  StravaError,
  stravaCallbackUrl,
  validateStravaConfiguration,
} from "./client";
import { requireStravaOrigin } from "./http";
import { stravaRpc } from "./store";

const cookiePrefix = "strava_oauth_";
const hash = (state: string) =>
  crypto.createHash("sha256").update(state).digest("hex");

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/strava",
  maxAge: 600,
};

function boundState(request: NextRequest) {
  const states = request.nextUrl.searchParams.getAll("state");
  const state = states[0];

  if (states.length !== 1 || !state || !/^[a-f0-9]{64}$/.test(state)) {
    throw new StravaError("invalid_state", 400);
  }

  const cookie = request.cookies.get(cookiePrefix + hash(state))?.value;

  if (
    !cookie ||
    !/^[a-f0-9]{64}$/.test(cookie) ||
    !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(cookie))
  ) {
    throw new StravaError("invalid_state", 400);
  }

  return hash(state);
}

function outcome(status: string) {
  const destination = new URL("/", stravaCallbackUrl());

  destination.searchParams.set("strava", status);

  const response = NextResponse.redirect(destination, 303);

  response.headers.set("Cache-Control", privateHeaders["Cache-Control"]);
  response.headers.set("Referrer-Policy", "no-referrer");

  return response;
}

export async function connectStrava(request: NextRequest) {
  requireStravaOrigin(request);

  const user = await requireUser();
  const callback = validateStravaConfiguration();
  const state = crypto.randomBytes(32).toString("hex");
  const result = await stravaRpc<string>("strava_begin_oauth", {
    p_user: user.id,
    p_hash: hash(state),
  });

  if (result !== "ready") {
    return outcome(result);
  }

  const response = NextResponse.redirect(
    createStravaAuthorizationUrl(callback.href, state),
    303,
  );

  response.headers.set("Cache-Control", privateHeaders["Cache-Control"]);
  response.headers.set("Referrer-Policy", "no-referrer");

  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith(cookiePrefix)) {
      response.cookies.set(cookie.name, "", { ...cookieOptions, maxAge: 0 });
    }
  }

  // Per-attempt names prevent a slow, old callback response from erasing a newer tab's binding.
  response.cookies.set(cookiePrefix + hash(state), state, cookieOptions);

  return response;
}

export async function cancelStravaAuthorization(request: NextRequest) {
  requireStravaOrigin(request);

  const user = await requireUser();
  let status = "cancelled";
  const bindings = request.cookies.getAll().filter(
    (cookie) =>
      /^[a-f0-9]{64}$/.test(cookie.value) &&
      cookie.name === cookiePrefix + hash(cookie.value),
  );

  for (const cookie of bindings) {
    status = await stravaRpc<string>("strava_cancel_oauth", {
      p_user: user.id,
      p_hash: hash(cookie.value),
    });
  }

  if ((await loadStravaConnection(user.id))?.status === "active") {
    status = "connected";
  }

  const response = NextResponse.json({ status }, { headers: privateHeaders });

  for (const cookie of bindings) {
    response.cookies.set(cookie.name, "", { ...cookieOptions, maxAge: 0 });
  }

  return response;
}

export async function finishStravaAuthorization(request: NextRequest) {
  const user = await requireUser();
  const stateHash = boundState(request);
  const result = await stravaRpc<string>("strava_claim_oauth", {
    p_user: user.id,
    p_hash: stateHash,
  });

  if (result !== "claimed") {
    return outcome(result === "processing" ? "in_progress" : result);
  }

  const params = request.nextUrl.searchParams;
  const codes = params.getAll("code");
  const errors = params.getAll("error");
  const scopes = params.getAll("scope");
  let status: string;

  if (errors.length === 1 && errors[0] === "access_denied" && !codes.length) {
    status = await stravaRpc<string>("strava_finish_oauth", {
      p_user: user.id,
      p_hash: stateHash,
      p_outcome: "cancelled",
    });
  } else {
    let tokens;

    try {
      if (
        errors.length ||
        codes.length !== 1 ||
        scopes.length !== 1 ||
        !codes[0] ||
        scopes[0].length > 1024
      ) {
        throw new StravaError("invalid_callback", 400);
      }

      tokens = await exchangeAuthorizationCode(
        codes[0],
        scopes[0].split(",").map((value) => value.trim()),
      );
    } catch (error) {
      await stravaRpc("strava_finish_oauth", {
        p_user: user.id,
        p_hash: stateHash,
      });

      return outcome(error instanceof StravaError ? error.code : "authorization_failed");
    }

    try {
      status = await saveStravaConnection(user.id, tokens, stateHash);
    } catch {
      status = await saveStravaConnection(user.id, tokens, stateHash);
    }
  }

  const response = outcome(status);

  response.cookies.set(cookiePrefix + stateHash, "", { ...cookieOptions, maxAge: 0 });

  return response;
}
