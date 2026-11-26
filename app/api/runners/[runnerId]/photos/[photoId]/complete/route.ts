import { photoMethods, emptyWriteBody, photoJson, photoRoute, type PhotoContext } from "@/lib/runnerPhotos/http";
import { completeRunnerPhotoUpload } from "@/lib/runnerPhotos/service";

export const dynamic = "force-dynamic";

const { OPTIONS, reject } = photoMethods("OPTIONS, POST");
export { OPTIONS, reject as GET, reject as HEAD, reject as PUT, reject as PATCH, reject as DELETE };

export function POST(request: Request, context: PhotoContext) {
  return photoRoute(context, async (userId, { runnerId, photoId }) => {
    await emptyWriteBody(request);
    return photoJson(await completeRunnerPhotoUpload(userId, runnerId, photoId));
  });
}
