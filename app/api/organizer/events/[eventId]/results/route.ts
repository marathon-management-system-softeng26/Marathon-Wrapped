import { requireUser } from "@/lib/auth/session";
import { getEventResults } from "@/controllers/organizerController";
import { eventIdFrom, organizerError, organizerFailure, privateHeaders } from "@/lib/organizerHttp";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const eventId = eventIdFrom((await params).eventId);
  if (!eventId) return organizerError("Invalid event identifier.", 400);
  try {
    const user = await requireUser();
    return Response.json({ results: await getEventResults(user.id, eventId) }, { headers: privateHeaders });
  } catch (cause) { return organizerFailure(cause); }
}
