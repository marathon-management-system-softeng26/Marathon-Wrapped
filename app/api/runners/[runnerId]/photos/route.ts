import { photoMethods, photoJson, photoRoute, writeBody, type RunnerContext } from "@/lib/runnerPhotos/http";
import { beginRunnerPhotoUpload, listRunnerPhotos } from "@/lib/runnerPhotos/service";

export const dynamic = "force-dynamic";

const { OPTIONS, reject } = photoMethods("GET, HEAD, OPTIONS, POST");
export { OPTIONS, reject as PUT, reject as PATCH, reject as DELETE };

export function GET(_request: Request, context: RunnerContext) {
  return photoRoute(context, async (userId, { runnerId }) =>
    photoJson({ photos: await listRunnerPhotos(userId, runnerId) }));
}

export function POST(request: Request, context: RunnerContext) {
  return photoRoute(context, async (userId, { runnerId }) =>
    photoJson(await beginRunnerPhotoUpload(userId, runnerId, await writeBody(request)), 201));
}
