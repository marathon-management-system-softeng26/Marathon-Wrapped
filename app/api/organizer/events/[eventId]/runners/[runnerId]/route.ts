import {
  handleHeroSave,
  eventIdFrom,
  organizerError,
  organizerFailure,
  privateHeaders,
} from "@/lib/organizerHttp";
import { requireUser } from "@/lib/auth/session";
import { getHeroDraft } from "@/controllers/organizerController";
import { isRunnerId } from "@/lib/runnerValidation";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string; runnerId: string }> },
) {
  const { eventId, runnerId } = await params;
  const event = eventIdFrom(eventId);
  if (!event || !isRunnerId(runnerId))
    return organizerError("Invalid event or runner identifier.", 400);
  try {
    const user = await requireUser();
    return Response.json(await getHeroDraft(user.id, event, runnerId), {
      headers: privateHeaders,
    });
  } catch (cause) {
    return organizerFailure(cause);
  }
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ eventId: string; runnerId: string }> },
) {
  const { eventId, runnerId } = await params;
  return handleHeroSave(request, eventId, runnerId);
}
