import { requireUser, AuthenticationError } from "@/lib/auth/session";
import { AccessDeniedError } from "@/lib/auth/access";
import { InvalidRunnerDataError, isRunnerId } from "@/lib/runnerValidation";
import { getWrappedForUser } from "@/lib/wrappedService";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const error = (message: string, status: number) => Response.json({ error: message }, { status, headers });

export async function GET(_request: Request, { params }: { params: Promise<{ runnerId: string }> }) {
  const { runnerId } = await params;
  if (!isRunnerId(runnerId)) return error("Invalid runner identifier.", 400);
  try {
    const user = await requireUser();
    const payload = await getWrappedForUser(user.id, runnerId);
    return payload ? Response.json(payload, { headers }) : error("Runner not found.", 404);
  } catch (cause) {
    if (cause instanceof AuthenticationError) return error(cause.message, 401);
    if (cause instanceof AccessDeniedError) return error("Runner not found.", 404);
    if (cause instanceof InvalidRunnerDataError) return error(cause.message, 422);
    return error("Race results are temporarily unavailable. Please retry.", 503);
  }
}
