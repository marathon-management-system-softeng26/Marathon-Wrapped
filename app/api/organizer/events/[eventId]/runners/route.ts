import { handleHeroSave } from "@/lib/organizerHttp";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  return handleHeroSave(request, (await params).eventId, null);
}
