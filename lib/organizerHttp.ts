import "server-only";
import { requireUser, AuthenticationError } from "@/lib/auth/session";
import { AccessDeniedError } from "@/lib/auth/access";
import { HeroValidationError } from "@/lib/heroValidation";
import { isRunnerId } from "@/lib/runnerValidation";
import { OrganizerSaveError, saveHeroRunner } from "@/controllers/organizerController";

export const privateHeaders = { "Cache-Control": "private, no-store" };
export const organizerError = (message: string, status: number) => Response.json({ error: message }, { status, headers: privateHeaders });
export function eventIdFrom(value: string): number | null {
  const id = /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
export function organizerFailure(cause: unknown): Response {
  if (cause instanceof AuthenticationError) return organizerError(cause.message, 401);
  if (cause instanceof AccessDeniedError) return organizerError("You do not have access to this event.", 403);
  if (cause instanceof HeroValidationError) return organizerError(cause.message, 422);
  if (cause instanceof OrganizerSaveError) return organizerError(cause.message, cause.status);
  if (cause instanceof SyntaxError) return organizerError("Send a valid JSON runner record.", 400);
  return organizerError("Runner management is temporarily unavailable. Please retry.", 503);
}
export async function handleHeroSave(request: Request, event: string, runnerId: string | null) {
  const eventId = eventIdFrom(event);
  if (!eventId || (runnerId !== null && !isRunnerId(runnerId))) return organizerError("Invalid event or runner identifier.", 400);
  // Next's internal URL may say localhost while the browser requested 127.0.0.1.
  // Trust the incoming Host, never a caller-supplied forwarded-host override.
  const internal = new URL(request.url);
  const expectedOrigin = `${internal.protocol}//${request.headers.get("host") ?? internal.host}`;
  if (request.headers.get("origin") !== expectedOrigin) return organizerError("Open this action from the application.", 403);
  try {
    const user = await requireUser();
    const saved = await saveHeroRunner(user.id, eventId, runnerId, await request.json());
    return Response.json(saved, { status: runnerId ? 200 : 201, headers: privateHeaders });
  } catch (cause) { return organizerFailure(cause); }
}
