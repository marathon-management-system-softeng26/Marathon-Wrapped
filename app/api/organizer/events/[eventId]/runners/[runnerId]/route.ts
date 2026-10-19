import { handleHeroSave } from "@/lib/organizerHttp";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, { params }: { params: Promise<{ eventId: string; runnerId: string }> }) {
  const { eventId, runnerId } = await params;
  return handleHeroSave(request, eventId, runnerId);
}
