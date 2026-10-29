import "server-only";
import crypto from "node:crypto";
import { getSupabaseAdmin } from "../supabaseServer";
import { stravaRpc } from "./store";

export type StravaCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type StravaTokens = StravaCredentials & {
  athleteId: string;
  scopes: string[];
};

export type StravaActivity = {
  id: string;
  athleteId: string;
  sportType: string;
  startDate: string;
  distanceMeters: number;
  startLatLng: [number, number] | null;
  polyline: string | null;
};

export type StravaConnection = {
  user_id: string;
  athlete_id: string | null;
  status: "active" | "reauth_required" | "disconnecting" | "disconnected";
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  generation: string;
  operation_id: string | null;
  granted_scopes: string[];
  credentials_uncertain: boolean;
};

export class StravaError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 503,
    public readonly retryAfter?: number,
  ) {
    super(`Strava: ${code}.`);
  }
}

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new StravaError("not_configured");
  }

  return value;
}

export function stravaCallbackUrl(): URL {
  let url: URL;

  try {
    url = new URL(required("STRAVA_CALLBACK_URL"));
  } catch {
    throw new StravaError("not_configured");
  }

  const local =
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    process.env.NODE_ENV !== "production";

  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/api/strava/callback" ||
    url.search ||
    url.hash
  ) {
    throw new StravaError("not_configured");
  }

  return url;
}

export function validateStravaConfiguration() {
  required("STRAVA_CLIENT_ID");
  required("STRAVA_CLIENT_SECRET");
  encryptionKey();

  return stravaCallbackUrl();
}

export function createStravaAuthorizationUrl(
  callbackUrl: string,
  state: string,
): string {
  if (callbackUrl !== stravaCallbackUrl().href || !/^[a-f0-9]{64}$/.test(state)) {
    throw new StravaError("invalid_oauth_request", 400);
  }

  const url = new URL("https://www.strava.com/oauth/authorize");

  url.search = new URLSearchParams({
    client_id: required("STRAVA_CLIENT_ID"),
    response_type: "code",
    redirect_uri: callbackUrl,
    scope: "activity:read_all",
    approval_prompt: "force",
    state,
  }).toString();

  return url.href;
}

export function stravaId(value: unknown): string {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new StravaError("invalid_id", 400);
  }

  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^[1-9]\d{0,18}$/.test(String(value))
  ) {
    throw new StravaError("invalid_id", 400);
  }

  return String(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StravaError("invalid_provider_response");
  }

  return value as Record<string, unknown>;
}

function token(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[\x21-\x7e]+$/.test(value) ||
    value.length > 8192
  ) {
    throw new StravaError("invalid_provider_response");
  }

  return value;
}

function credentials(value: unknown): StravaCredentials {
  const data = record(value);

  if (
    !Number.isSafeInteger(data.expires_at) ||
    Number(data.expires_at) <= Date.now() / 1000 ||
    Number(data.expires_at) > 8640000000000
  ) {
    throw new StravaError("invalid_provider_response");
  }

  return {
    accessToken: token(data.access_token),
    refreshToken: token(data.refresh_token),
    expiresAt: Number(data.expires_at),
  };
}

async function providerRequest(
  path: string,
  init: RequestInit = {},
  json = true,
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(`https://www.strava.com${path}`, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new StravaError("provider_unavailable");
  }

  if (!response.ok) {
    if (response.status === 429) {
      const retry = response.headers.get("retry-after");
      const seconds =
        retry && /^\d+$/.test(retry)
          ? Number(retry)
          : retry
            ? (Date.parse(retry) - Date.now()) / 1000
            : 0;

      // Strava daily budget limit check
      const daily = ["", "read-"].some((prefix) => {
        const limit = response.headers
          .get(`x-${prefix}ratelimit-limit`)
          ?.split(",")
          .map(Number);
        const usage = response.headers
          .get(`x-${prefix}ratelimit-usage`)
          ?.split(",")
          .map(Number);

        return limit?.length === 2 && usage?.length === 2 && usage[1] >= limit[1];
      });
      const reset = daily
        ? 86400 - (Math.floor(Date.now() / 1000) % 86400)
        : 900 - (Math.floor(Date.now() / 1000) % 900);

      throw new StravaError(
        "rate_limited",
        503,
        Math.min(
          86400,
          Math.max(1, reset, Number.isFinite(seconds) ? Math.ceil(seconds) : 0),
        ),
      );
    }

    if (response.status === 401) {
      throw new StravaError(
        path.startsWith("/oauth/") ? "invalid_client_credentials" : "reauth_required",
        path.startsWith("/oauth/") ? 503 : 409,
      );
    }

    if (response.status === 403) {
      throw new StravaError("forbidden", 403);
    }

    if (response.status === 404) {
      throw new StravaError("not_found", 404);
    }

    if (response.status >= 500) {
      throw new StravaError("provider_unavailable");
    }

    if (path === "/oauth/token" && response.status === 400) {
      const body = await response.json().catch(() => null);
      const invalidRefresh =
        body &&
        Array.isArray(body.errors) &&
        body.errors.some(
          (error: Record<string, unknown> | null) =>
            error && error.resource === "RefreshToken" && error.code === "invalid",
        );

      if (invalidRefresh) {
        throw new StravaError("authorization_revoked", 409);
      }
    }

    throw new StravaError("provider_rejected", 422);
  }

  if (!json) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    throw new StravaError("invalid_provider_response");
  }
}

async function tokenRequest(params: Record<string, string>) {
  return providerRequest("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: required("STRAVA_CLIENT_ID"),
      client_secret: required("STRAVA_CLIENT_SECRET"),
      ...params,
    }),
  });
}

export async function exchangeAuthorizationCode(
  code: string,
  scopes: string[],
): Promise<StravaTokens> {
  if (!code.trim() || code.length > 2048 || !scopes.includes("activity:read_all")) {
    throw new StravaError("insufficient_scope", 400);
  }

  const data = record(await tokenRequest({ code, grant_type: "authorization_code" }));

  return {
    ...credentials(data),
    athleteId: stravaId(record(data.athlete).id),
    scopes: [...new Set(scopes)],
  };
}

export async function refreshStravaTokens(
  refreshToken: string,
): Promise<StravaCredentials> {
  return credentials(
    await tokenRequest({
      refresh_token: token(refreshToken),
      grant_type: "refresh_token",
    }),
  );
}

function encryptionKey() {
  const key = required("STRAVA_ENCRYPTION_KEY");

  if (!/^[a-f0-9]{64}$/i.test(key)) {
    throw new StravaError("invalid_encryption_key");
  }

  return Buffer.from(key, "hex");
}

export async function encryptToken(value: string): Promise<string> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);

  return (
    cipher.update(token(value), "utf8", "hex") +
    cipher.final("hex") +
    cipher.getAuthTag().toString("hex") +
    iv.toString("hex")
  );
}

export async function decryptToken(value: string): Promise<string> {
  if (!/^[a-f0-9]+$/i.test(value) || value.length <= 56 || value.length % 2) {
    throw new StravaError("invalid_encrypted_token");
  }

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(value.slice(-24), "hex"),
    );

    decipher.setAuthTag(Buffer.from(value.slice(-56, -24), "hex"));

    return decipher.update(value.slice(0, -56), "hex", "utf8") + decipher.final("utf8");
  } catch {
    throw new StravaError("invalid_encrypted_token");
  }
}

async function encryptedCredentials(value: StravaCredentials) {
  return {
    access_token: await encryptToken(value.accessToken),
    refresh_token: await encryptToken(value.refreshToken),
    expires_at: new Date(value.expiresAt * 1000).toISOString(),
  };
}

export async function saveStravaConnection(
  userId: string,
  tokens: StravaTokens,
  stateHash: string,
): Promise<string> {
  if (!tokens.scopes.includes("activity:read_all")) {
    throw new StravaError("insufficient_scope", 400);
  }

  return stravaRpc<string>("strava_finish_oauth", {
    p_user: userId,
    p_hash: stateHash,
    p_outcome: "connected",
    p_tokens: {
      ...await encryptedCredentials(tokens),
      athlete_id: stravaId(tokens.athleteId),
      scopes: tokens.scopes,
    },
  });
}

export async function loadStravaConnection(
  userId: string,
): Promise<StravaConnection | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("strava_connections")
    .select(
      "user_id,athlete_id,status,access_token,refresh_token,expires_at,generation,operation_id,granted_scopes,credentials_uncertain",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Strava storage is temporarily unavailable.");
  }

  return data as StravaConnection | null;
}

export async function getUserStravaAccessToken(
  userId: string,
  forceRefresh = false,
): Promise<string | null> {
  const connection = await loadStravaConnection(userId);

  if (!connection || ["disconnected", "disconnecting"].includes(connection.status)) {
    return null;
  }

  if (connection.status !== "active") {
    throw new StravaError("reauth_required", 409);
  }

  if (
    !forceRefresh &&
    connection.expires_at &&
    Date.parse(connection.expires_at) > Date.now() + 60000 &&
    connection.access_token
  ) {
    return decryptToken(connection.access_token);
  }

  const claimed = await stravaRpc<(StravaConnection & { busy?: boolean }) | null>(
    "strava_claim_credentials",
    { p_user: userId, p_kind: "refresh" },
  );

  if (claimed?.busy) {
    throw new StravaError("connection_busy", 409, 3);
  }

  if (!claimed) {
    throw new StravaError("reauth_required", 409);
  }

  let refreshed: StravaCredentials;

  try {
    if (
      !forceRefresh &&
      claimed.expires_at &&
      Date.parse(claimed.expires_at) > Date.now() + 60000 &&
      claimed.access_token
    ) {
      const active = await stravaRpc<boolean>("strava_finish_refresh", {
        p_user: userId,
        p_operation: claimed.operation_id,
        p_generation: claimed.generation,
      });

      return active ? decryptToken(claimed.access_token) : null;
    }

    if (!claimed.refresh_token) {
      throw new StravaError("reauth_required", 409);
    }

    refreshed = await refreshStravaTokens(await decryptToken(claimed.refresh_token));
  } catch (error) {
    const safeRetry = error instanceof StravaError && error.retryAfter !== undefined;
    const uncertain =
      error instanceof StravaError &&
      ["provider_unavailable", "invalid_provider_response", "invalid_encrypted_token"].includes(
        error.code,
      );

    await stravaRpc("strava_finish_refresh", {
      p_user: userId,
      p_operation: claimed.operation_id,
      p_generation: claimed.generation,
      p_reauth: !safeRetry,
      p_uncertain: uncertain,
    });

    throw error;
  }

  // If storage fails, keep the operation fenced. Re-exchanging an old rotating token is unsafe.
  const saved = await stravaRpc<boolean>("strava_finish_refresh", {
    p_user: userId,
    p_operation: claimed.operation_id,
    p_generation: claimed.generation,
    p_tokens: await encryptedCredentials(refreshed),
  });

  if (!saved) {
    return null;
  }

  return refreshed.accessToken;
}

function normalizeActivity(value: unknown, athleteId?: string): StravaActivity {
  const data = record(value);
  const owner = stravaId(record(data.athlete).id);

  if (athleteId && owner !== athleteId) {
    throw new StravaError("athlete_mismatch", 403);
  }

  if (
    typeof data.sport_type !== "string" ||
    !data.sport_type ||
    typeof data.start_date !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(data.start_date) ||
    !Number.isFinite(Date.parse(data.start_date)) ||
    typeof data.distance !== "number" ||
    !Number.isFinite(data.distance) ||
    data.distance < 0
  ) {
    throw new StravaError("invalid_provider_response");
  }

  let start: [number, number] | null = null;

  if (
    data.start_latlng !== null &&
    data.start_latlng !== undefined &&
    !(Array.isArray(data.start_latlng) && !data.start_latlng.length)
  ) {
    const coords = data.start_latlng;

    if (
      !Array.isArray(coords) ||
      coords.length !== 2 ||
      !coords.every((n) => typeof n === "number" && Number.isFinite(n)) ||
      Math.abs(coords[0]) > 90 ||
      Math.abs(coords[1]) > 180
    ) {
      throw new StravaError("invalid_provider_response");
    }

    start = coords as [number, number];
  }

  const map = data.map ? record(data.map) : {};
  const polyline = [map.polyline, map.summary_polyline].find(
    (v) => typeof v === "string" && v.length > 0,
  );

  if (typeof polyline === "string" && polyline.length > 1000000) {
    throw new StravaError("invalid_provider_response");
  }

  return {
    id: stravaId(data.id),
    athleteId: owner,
    sportType: data.sport_type,
    startDate: new Date(data.start_date).toISOString(),
    distanceMeters: data.distance,
    startLatLng: start,
    polyline: typeof polyline === "string" ? polyline : null,
  };
}

export async function getStravaActivity(
  accessToken: string,
  activityId: string,
  athleteId?: string,
): Promise<StravaActivity> {
  const activity = normalizeActivity(
    await providerRequest(`/api/v3/activities/${stravaId(activityId)}`, {
      headers: { Authorization: `Bearer ${token(accessToken)}` },
    }),
    athleteId,
  );

  if (activity.id !== activityId) {
    throw new StravaError("activity_mismatch", 403);
  }

  return activity;
}

export async function verifyStravaAuthorization(
  accessToken: string,
  athleteId: string,
): Promise<void> {
  const data = record(
    await providerRequest("/api/v3/athlete", {
      headers: { Authorization: `Bearer ${token(accessToken)}` },
    }),
  );

  if (stravaId(data.id) !== athleteId) {
    throw new StravaError("athlete_mismatch", 403);
  }
}

export async function listStravaActivities(
  accessToken: string,
  after: number,
  before: number,
  page = 1,
  athleteId?: string,
): Promise<StravaActivity[]> {
  if (
    ![after, before, page].every(Number.isSafeInteger) ||
    after < 0 ||
    before <= after ||
    page < 1 ||
    page > 10000
  ) {
    throw new StravaError("invalid_window", 400);
  }

  const params = new URLSearchParams({
    after: String(after),
    before: String(before),
    page: String(page),
    per_page: "25",
  });
  const data = await providerRequest(`/api/v3/athlete/activities?${params}`, {
    headers: { Authorization: `Bearer ${token(accessToken)}` },
  });

  if (!Array.isArray(data) || data.length > 25) {
    throw new StravaError("invalid_provider_response");
  }

  return data.map((item) => normalizeActivity(item, athleteId));
}

export async function revokeStravaAccess(value: string): Promise<void> {
  await providerRequest(
    "/oauth/revoke",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${required("STRAVA_CLIENT_ID")}:${required("STRAVA_CLIENT_SECRET")}`,
        ).toString("base64")}`,
      },
      body: new URLSearchParams({
        token: token(value),
        token_type_hint: "refresh_token",
      }),
    },
    false,
  );
}
