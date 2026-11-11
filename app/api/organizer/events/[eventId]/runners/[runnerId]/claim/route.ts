import { isRunnerId } from "@/lib/runnerValidation";
import { AccessDeniedError, requireOrganizerAccess } from "@/lib/auth/access";
import { requireUser, AuthenticationError } from "@/lib/auth/session";
import { createRunnerClaim, revokeRunnerClaim } from "@/lib/auth/runnerClaims";
import { eventIdFrom, privateHeaders, organizerNotFound } from "@/lib/organizerHttp";
import { sameOrigin } from "@/lib/authHttp";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
const fail = (message: string, status: number) => Response.json({ error: message }, { status, headers: privateHeaders });
async function scopeRunnerToEvent(eventId: number, runnerId: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  const runner = await db.from("runners").select("category_id").eq("id", runnerId).maybeSingle();
  if (runner.error) throw new Error("Runner claim service is unavailable.");
  if (!runner.data) return false;
  const category = await db.from("categories").select("event_id").eq("id", runner.data.category_id).maybeSingle();
  if (category.error) throw new Error("Runner claim service is unavailable.");
  return category.data?.event_id === eventId;
}
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
async function routeScope(context: { params: Promise<{ eventId: string; runnerId: string }> }) { return context.params; }
export async function POST(request: Request, context: { params: Promise<{ eventId: string; runnerId: string }> }) {
  if (!sameOrigin(request)) return fail("Open this action from the application.", 403);
  const { eventId: rawEvent, runnerId } = await routeScope(context);
  const eventId = eventIdFrom(rawEvent);
  if (!eventId || !isRunnerId(runnerId)) return fail("Invalid event or runner identifier.", 400);
  try {
    const user = await requireUser();
    await requireOrganizerAccess(user.id, eventId);
    if (!(await scopeRunnerToEvent(eventId, runnerId))) return organizerNotFound();
    const claim = await createRunnerClaim(user.id, eventId, runnerId);
    return Response.json(claim, { status: 201, headers: { ...privateHeaders, "Referrer-Policy": "no-referrer" } });
  } catch (cause) {
    if (cause instanceof AuthenticationError) return fail(cause.message, 401);
    if (cause instanceof AccessDeniedError) return organizerNotFound();
    return fail("Runner claim service is temporarily unavailable. Please retry.", 503);
  }
}
export async function DELETE(request: Request, context: { params: Promise<{ eventId: string; runnerId: string }> }) {
  if (!sameOrigin(request)) return fail("Open this action from the application.", 403);
  const { eventId: rawEvent, runnerId } = await routeScope(context);
  const eventId = eventIdFrom(rawEvent);
  if (!eventId || !isRunnerId(runnerId)) return fail("Invalid event or runner identifier.", 400);
  try {
    const user = await requireUser();
    await requireOrganizerAccess(user.id, eventId);
    if (!(await scopeRunnerToEvent(eventId, runnerId))) return organizerNotFound();
    let body: unknown;
    try { body = await boundedJson(request); } catch { return fail("Send a valid claim identifier.", 400); }
    const claimId = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).claimId : null;
    if (typeof claimId !== "string" || !isRunnerId(claimId)) return fail("Send a valid claim identifier.", 400);
    await revokeRunnerClaim(user.id, eventId, claimId);
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch (cause) {
    if (cause instanceof AuthenticationError) return fail(cause.message, 401);
    if (cause instanceof AccessDeniedError) return organizerNotFound();
    return fail("Runner claim service is temporarily unavailable. Please retry.", 503);
  }
}