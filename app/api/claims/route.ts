import { requireUser, AuthenticationError } from "@/lib/auth/session";
import { consumeRunnerClaim, invalidRunnerClaimMessage } from "@/lib/auth/runnerClaims";
import { boundedJson, privateHeaders, sameOrigin } from "@/lib/authHttp";
const errorResponse = (error: string, status: number) => Response.json({ error }, { status, headers: privateHeaders });
export async function POST(request: Request) {
  if (!sameOrigin(request)) return errorResponse("Open this action from the application.", 403);
  try {
    const user = await requireUser();
    let body: unknown;
    try { body = await boundedJson(request); } catch { return errorResponse("Send a valid claim token.", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("Send a valid claim token.", 400);
    const token = (body as Record<string, unknown>).token;
    if (typeof token !== "string" || token.length > 128) return errorResponse("Send a valid claim token.", 400);
    const status = await consumeRunnerClaim(user.id, token);
    return Response.json({ status }, { headers: privateHeaders });
  } catch (cause) {
    if (cause instanceof AuthenticationError) return errorResponse(cause.message, 401);
    if (cause instanceof Error && cause.message === invalidRunnerClaimMessage) return errorResponse(invalidRunnerClaimMessage, 400);
    return errorResponse("Runner claim service is temporarily unavailable. Please retry.", 503);
  }
}
