import { requireUser, AuthenticationError } from "@/lib/auth/session";
import { AccessDeniedError } from "@/lib/auth/access";
import { privateHeaders } from "@/lib/authHttp";
import { isRunnerId } from "@/lib/runnerValidation";
import { getStravaWrappedForUser } from "@/lib/stravaWrappedService";
import { getOfficialWrappedForUser } from "@/lib/officialWrappedService";
import { hasWrappedGallery, loadPersonalWrappedPhotos, mergePersonalRunnerPhotos } from "@/lib/runnerPhotos/wrapped";

export const dynamic = "force-dynamic";
const error = (message: string, status: number) => Response.json({ error: message }, { status, headers: privateHeaders });

export async function GET(_request: Request, { params }: { params: Promise<{ runnerId: string }> }) {
  const { runnerId } = await params;
  if (!isRunnerId(runnerId)) return error("Invalid runner identifier.", 400);
  try {
    const user = await requireUser();
    const id = runnerId.toLowerCase();
    const db = (await import("@/lib/supabaseServer")).getSupabaseAdmin();
    const direct = await db.from("runner_access").select("runner_id").eq("user_id", user.id).eq("runner_id", id).maybeSingle();
    if (direct.error) return error("Wrapped is temporarily unavailable. Please retry.", 503);
    if (!direct.data) return error("Runner not found.", 404);
    let official = null;
    try {
      official = await getOfficialWrappedForUser(user.id, id, true);
    } catch {
      // Legacy databases may not have the additive official-results tables yet.
    }
    let payload = official ?? await getStravaWrappedForUser(user.id, id);
    if (hasWrappedGallery(payload)) {
      const photos = await loadPersonalWrappedPhotos(user.id, id);
      if (photos) payload = mergePersonalRunnerPhotos(payload, photos);
    }
    return Response.json(payload, { headers: privateHeaders });
  } catch (cause) {
    if (cause instanceof AuthenticationError) return error(cause.message, 401);
    if (cause instanceof AccessDeniedError) return error("Runner not found.", 404);
    return error("Wrapped is temporarily unavailable. Please retry.", 503);
  }
}
