import "server-only"
import { getSupabaseAdmin } from "../supabaseServer";
import crypto from "crypto";

export type StravaTokens = {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    athleteId: string;
    scopes: string[];
};

export type StravaActivity = {
    id: string;
    sportType: string;
    startDate: string;
    distanceMeters: number;
    startLatLng: [latitude: number, longitude: number] | null;
    polyline: string | null;
};

/*
 * pseudocode:
 * Caller first verifies the app user and stores a random, short-lived OAuth
 * state bound to that user. This helper only builds the authorization URL.
 *
 * require STRAVA_CLIENT_ID and a nonempty state
 * require callbackUrl to match the configured, trusted callback URL
 * create URL("https://www.strava.com/oauth/authorize")
 * set query parameters using URLSearchParams:
 *     client_id = STRAVA_CLIENT_ID
 *     response_type = "code"
 *     redirect_uri = callbackUrl
 *     scope = "activity:read_all"
 *     approval_prompt = "force"
 *     state = supplied state
 * return the URL string for the connect endpoint to redirect to
 *
 * Never put the client secret or user tokens into this URL.
 * Docs: https://developers.strava.com/docs/authentication/#requesting-access
 */
export function createStravaAuthorizationUrl(callbackUrl: string, state: string): string | undefined {
    
    const clientId = process.env.STRAVA_CLIENT_ID;
    const params = new URLSearchParams({
        client_id: clientId!,
        response_type: "code",
        redirect_uri: callbackUrl.toString(),
        approval_prompt: "force",
        scope: "activity:read_all",
        state: state,
    });

    const oauth_uri = `http://www.strava.com/oauth/authorize?${params}`;
    return oauth_uri;
}

/*
 * pseudocode:
 * Callback first verifies the app user, consumes the matching OAuth state,
 * handles access_denied, and checks the scopes actually granted by the user.
 *
 * require a nonempty authorization code and server-side client credentials
 * POST form data to https://www.strava.com/oauth/token:
 *     client_id, client_secret, code, grant_type = "authorization_code"
 * use a request timeout and reject non-success responses
 * validate access_token, refresh_token, expires_at, and athlete.id
 * normalize snake_case response fields into the StravaTokens shape
 * use the actual granted scopes, never assume all requested scopes were granted
 * return tokens to the backend callback, not to the browser
 *
 * contract: the callback may need to pass its granted scopes here, or merge
 * them into the result before saveStravaConnection; code alone cannot supply
 * callback query parameters. Do not blindly retry a consumed, single-use code.
 * Docs: https://developers.strava.com/docs/authentication/#token-exchange
 */
export async function exchangeAuthorizationCode(
    code: string,
): Promise<StravaTokens | undefined> { }

/*
 * pseudocode:
 * require a nonempty refresh token and server-side client credentials
 * POST form data to https://www.strava.com/oauth/token:
 *     client_id, client_secret, refresh_token, grant_type = "refresh_token"
 * use a request timeout and validate the response status and token fields
 * if authorization is revoked or the refresh token is invalid:
 *     report that the connection needs authorization again
 * if rate-limited or temporarily unavailable:
 *     surface a retryable failure without deleting the stored connection
 * return the returned access token, refresh token, and expiry together
 *
 * contract: refresh responses do not provide athlete identity or scopes.
 * Narrow the return type to refreshed credentials when implementing; the caller
 * must preserve athleteId and scopes from the existing connection.
 * Docs: https://developers.strava.com/docs/authentication/#refreshing-expired-access-tokens
 */
export async function refreshStravaTokens(
    refreshToken: string,
): Promise<StravaTokens | undefined> { }

/*
 * pseudocode:
 * require userId from verified app authentication, not a browser-supplied ID
 * validate athlete ID, token fields, expiry, and the required granted scopes
 * reject an athlete already linked to another app user
 * encrypt accessToken and refreshToken with a server-held encryption key
 * atomically save the connection keyed by user_id:
 *     athlete_id, encrypted tokens, expires_at, granted_scopes
 * use a database uniqueness constraint to prevent concurrent duplicate links
 * fail the callback if persistence fails; do not claim the account is connected
 *
 * Keep tokens out of profile responses, logs, and Wrapped payloads. Backend-only
 * table grants/RLS protect the row; the encryption key stays outside the database.
 */
export async function saveStravaConnection(
    userId: string,
    tokens: StravaTokens,
): Promise<void> { }

export async function encryptToken(token: string): Promise<string> {
    const encryptionKey = process.env.STRAVA_ENCRYPTION_KEY;
    if (!encryptionKey) {
        throw new Error("Encryption key is not set.");
    }

    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(encryptionKey, "hex"), iv)

    const encrypted = cipher.update(token, "utf8", "hex") + cipher.final("hex")
    const authTag = cipher.getAuthTag().toString("hex")
    return encrypted + authTag + iv.toString("hex");
}

export async function decryptToken(encryptedToken: string): Promise<string> {
    const encryptionKey = process.env.STRAVA_ENCRYPTION_KEY;
    if (!encryptionKey) {
        throw new Error("Encryption key is not set.");
    }

    const authTag = Buffer.from(encryptedToken.slice(-56, -24), "hex")
    const iv = Buffer.from(encryptedToken.slice(-24), "hex")
    const encrypted = encryptedToken.slice(0, -56)
    
    const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(encryptionKey, "hex"), iv)
    decipher.setAuthTag(authTag)

    return decipher.update(encrypted, "hex", "utf8") + decipher.final("utf8")
    
}

/*
 * pseudocode:
 * load the server-only connection for the supplied, authorized userId
 * if no active connection exists:
 *     return null so the caller can report Strava disconnected
 * compare expires_at (Unix seconds) against current time plus a safety margin
 * if the access token is still valid:
 *     decrypt and return it
 * otherwise coordinate refreshes for this connection and re-read its latest row
 * if another request already refreshed it:
 *     return that saved access token
 * refresh using the latest decrypted refresh token
 * atomically persist the returned token pair and expiry, preserving athlete/scopes
 * return the new access token only after persistence succeeds
 * if authorization is revoked:
 *     mark the connection disconnected and report reauthorization is required
 * if storage, rate limits, or networking fail:
 *     surface an error rather than pretending the user has no connection
 *
 */
export async function getUserStravaAccessToken(
    userId: string,
): Promise<string | null | undefined> {
    
    const {data: connection, error} = await getSupabaseAdmin().from("strava_connections")
    .select("access_token, expires_at, refresh_token").eq("user_id", userId).maybeSingle();
    
    if (error) {
        throw new Error("Failed to fetch Strava connection.");
    }
    
    if (!connection) {
        return null; // No active connection
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const safetyMargin = 60; // seconds
    if (connection.expires_at > currentTime + safetyMargin) {
        return decryptToken(connection.access_token); // Token is still valid
    }
    
    const refreshToken = await decryptToken(connection.refresh_token);
    if (!refreshToken) {
        throw new Error("Failed to decrypt Strava refresh token.");
    }
    const refreshedTokens = await refreshStravaTokens(connection.refresh_token);
    if (!refreshedTokens) {
        throw new Error("Failed to refresh Strava tokens.");
    }

    const { error: updateError } = await getSupabaseAdmin().from("strava_connections")
        .update({
            access_token: await encryptToken(refreshedTokens.accessToken),
            refresh_token: await encryptToken(refreshedTokens.refreshToken),
            expires_at: refreshedTokens.expiresAt,
        })
        .eq("user_id", userId);

    if (updateError) {
        throw new Error("Failed to save refreshed Strava tokens.");
    }


    return decryptToken(refreshedTokens.accessToken);
}


/*
 * pseudocode:
 * validate activityId and require the linked athlete's valid access token
 * GET https://www.strava.com/api/v3/activities/{activityId}
 *     Authorization: Bearer <accessToken>
 * use a request timeout and disable shared caching of personal activity data
 * validate the response fields before using them for matching
 * normalize id, sport_type, start_date, distance, and start_latlng
 * choose nonempty map.polyline, otherwise map.summary_polyline, otherwise null
 * return the normalized StravaActivity without credentials
 * if GPS is absent:
 *     return null coordinates/polyline, never fabricate a race route
 * if 401, 403, 404, 429, or a server error occurs:
 *     distinguish authorization, missing/inaccessible data, and retryable failures
 *
 * contract: retain the raw athlete.id for ownership verification in the
 * worker, or pass expected athlete identity to verify before normalization.
 * Docs: https://developers.strava.com/docs/reference/#api-Activities-getActivityById
 */
export async function getStravaActivity(
    accessToken: string,
    activityId: string,
): Promise<StravaActivity | undefined> { }

/*
 * pseudocode:
 * validate after/before as Unix seconds, after < before, and page >= 1
 * GET https://www.strava.com/api/v3/athlete/activities
 *     Authorization: Bearer <accessToken>
 *     query = after, before, page (default 1), bounded per_page
 * use the same timeout, private caching, and error handling as activity retrieval
 * validate and normalize this page of summary activities
 * use map.summary_polyline where available; summary data may lack full detail
 * return the page, including an empty array when no more activities remain
 *
 * Backfill caller walks pages within the race window and a bounded job budget,
 * fetches details for plausible candidates, and reuses the normal matcher.
 * Filters refer to activity start time, not when the watch uploaded the activity.
 * Docs: https://developers.strava.com/docs/reference/#api-Activities-getLoggedInAthleteActivities
 */
export async function listStravaActivities(accessToken: string, after: number, before: number, page?: number): Promise<StravaActivity[] | undefined> { 

}

/*
 * pseudocode:
 * require the user's token and server-side client credentials
 * POST https://www.strava.com/oauth/revoke with form data:
 *     token = accessToken, token_type_hint = "access_token"
 * authenticate using HTTP Basic Auth with client_id and client_secret
 * use a request timeout; never log the Authorization header or token
 * accept HTTP 200 with an empty body, including already-revoked tokens
 * surface invalid app credentials and retryable provider failures separately
 * let the disconnect service handle local connection and route cleanup
 *
 * Docs: https://developers.strava.com/docs/authentication/#deauthorization
 */
export async function revokeStravaAccess(accessToken: string): Promise<void> { 

}
