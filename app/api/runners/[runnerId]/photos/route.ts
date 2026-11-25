import { photoJson, photoRoute, writeBody, type RunnerContext } from "@/lib/runnerPhotos/http";
import { beginRunnerPhotoUpload, listRunnerPhotos } from "@/lib/runnerPhotos/service";

export const dynamic = "force-dynamic";

export function GET(_request: Request, context: RunnerContext) {
  return photoRoute(context, async (userId, { runnerId }) =>
    photoJson({ photos: await listRunnerPhotos(userId, runnerId) }));
}

export function POST(request: Request, context: RunnerContext) {
  return photoRoute(context, async (userId, { runnerId }) =>
    photoJson(await beginRunnerPhotoUpload(userId, runnerId, await writeBody(request)), 201));
}
