import { emptyWriteBody, photoJson, photoRoute, type PhotoContext } from "@/lib/runnerPhotos/http";
import { completeRunnerPhotoUpload } from "@/lib/runnerPhotos/service";

export const dynamic = "force-dynamic";

export function POST(request: Request, context: PhotoContext) {
  return photoRoute(context, async (userId, { runnerId, photoId }) => {
    await emptyWriteBody(request);
    return photoJson(await completeRunnerPhotoUpload(userId, runnerId, photoId));
  });
}
