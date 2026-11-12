import "server-only";
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../auth/session";
import { requireRunnerAccess } from "../auth/access";
import { privateHeaders } from "../authHttp";
import { isRunnerId } from "../runnerValidation";
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
import { enqueueRunnerStravaBackfill } from "./processing";

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

const outcomeCodes = new Set([
  "already_connected", "connected", "cancelled", "disconnecting", "expired",
  "failed", "in_progress", "invalid_state", "athlete_conflict", "insufficient_scope",
  "invalid_callback", "invalid_id", "invalid_provider_response", "provider_unavailable",
  "provider_rejected", "rate_limited", "authorization_revoked", "forbidden", "not_found",
  "authorization_failed", "different_runner",
  "import_failed",
]);

type RunnerOAuthAttempt = {
  status: string;
  runner_id: string | null;
  return_path: string | null;
  generation: string | null;
};

function outcome(status: string, returnPath = "/") {
  const destination = new URL(returnPath, stravaCallbackUrl());

  destination.searchParams.set("strava", outcomeCodes.has(status) ? status : "authorization_failed");

  const response = NextResponse.redirect(destination, 303);

  response.headers.set("Cache-Control", privateHeaders["Cache-Control"]);
  response.headers.set("Referrer-Policy", "no-referrer");

  return response;
}

async function enqueueBackfillWithRetry(userId: string, runnerId: string): Promise<boolean> {
  try {
    await enqueueRunnerStravaBackfill(userId, runnerId);
    return true;
  } catch {
    try {
      await enqueueRunnerStravaBackfill(userId, runnerId);
      return true;
    } catch {
      return false;
    }
  }
}

export async function connectStrava(request: NextRequest) {
  requireStravaOrigin(request);

  const user = await requireUser();
  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    throw new StravaError("invalid_runner", 400);
  }

  const runners = form.getAll("runnerId");
  const runner = runners[0];

  if (runners.length !== 1 || typeof runner !== "string" || !isRunnerId(runner)) {
    throw new StravaError("invalid_runner", 400);
  }

  const runnerId = runner.toLowerCase();

  await requireRunnerAccess(user.id, runnerId);

  const returnPath = `/wrapped/${runnerId}`;
  const callback = validateStravaConfiguration();
  const state = crypto.randomBytes(32).toString("hex");
  const result = await stravaRpc<string>("strava_begin_runner_oauth", {
    p_user: user.id,
    p_runner: runnerId,
    p_hash: hash(state),
    p_return_path: returnPath,
  });

  if (result !== "ready") {
    if (result === "already_connected" && !await enqueueBackfillWithRetry(user.id, runnerId)) {
      return outcome("import_failed", returnPath);
    }
    return outcome(result, returnPath);
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
  const attempt = await stravaRpc<RunnerOAuthAttempt>("strava_claim_runner_oauth", {
    p_user: user.id,
    p_hash: stateHash,
  });

  // Missing/removed access has no trusted recap destination. Never recover it from the URL.
  if (attempt?.status === "invalid_state" && attempt.runner_id === null && attempt.return_path === null) {
    return outcome("invalid_state");
  }

  if (
    !attempt || typeof attempt.runner_id !== "string" || !isRunnerId(attempt.runner_id) ||
    attempt.return_path !== `/wrapped/${attempt.runner_id}`
  ) {
    throw new StravaError("invalid_state", 400);
  }

  const returnPath = attempt.return_path;
  const complete = (result: string) => {
    const response = outcome(result, returnPath);
    response.cookies.set(cookiePrefix + stateHash, "", { ...cookieOptions, maxAge: 0 });
    return response;
  };

  if (attempt.status !== "claimed") {
    if (attempt.status === "connected" && !await enqueueBackfillWithRetry(user.id, attempt.runner_id)) {
      return complete("import_failed");
    }
    return complete(attempt.status === "processing" ? "in_progress" : attempt.status);
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

      return outcome(error instanceof StravaError ? error.code : "authorization_failed", returnPath);
    }

    try {
      status = await saveStravaConnection(user.id, tokens, stateHash);
    } catch {
      try {
        status = await saveStravaConnection(user.id, tokens, stateHash);
      } catch {
        return complete("authorization_failed");
      }
    }
  }

  if (status === "connected" && !await enqueueBackfillWithRetry(user.id, attempt.runner_id)) {
    return complete("import_failed");
  }

  return complete(status);
}
