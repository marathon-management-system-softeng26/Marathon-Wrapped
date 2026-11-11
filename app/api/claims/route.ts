import { requireUser, AuthenticationError } from "@/lib/auth/session";
import { consumeRunnerClaim, invalidRunnerClaimMessage } from "@/lib/auth/runnerClaims";
import { privateHeaders, sameOrigin } from "@/lib/authHttp";
const errorResponse = (error: string, status: number) => Response.json({ error }, { status, headers: privateHeaders });
async function boundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new SyntaxError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024) { await reader.cancel(); throw new RangeError(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
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
