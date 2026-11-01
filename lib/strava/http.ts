import "server-only";
import { AuthenticationError } from "../auth/session";
import { privateHeaders, sameOrigin } from "../authHttp";
import { StravaError, stravaCallbackUrl } from "./client";

export function requireStravaOrigin(request: Request) {
  if (
    !sameOrigin(request) ||
    new URL(request.url).origin !== stravaCallbackUrl().origin
  ) {
    throw new StravaError("invalid_origin", 403);
  }
}

export function stravaErrorResponse(error: unknown) {
  const status =
    error instanceof AuthenticationError
      ? 401
      : error instanceof StravaError
        ? error.status
        : 503;
  const code =
    error instanceof AuthenticationError
      ? "sign_in_required"
      : error instanceof StravaError
        ? error.code
        : "temporarily_unavailable";

  return Response.json(
    { error: code },
    {
      status,
      headers: {
        ...privateHeaders,
        "Referrer-Policy": "no-referrer",
        ...(error instanceof StravaError && error.retryAfter
          ? { "Retry-After": String(error.retryAfter) }
          : {}),
      },
    },
  );
}
