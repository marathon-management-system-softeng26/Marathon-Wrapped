import { privateHeaders } from "@/lib/authHttp";
import { photoMethods, emptyWriteBody, photoJson, photoRoute, writeBody, type PhotoContext } from "@/lib/runnerPhotos/http";
import { deleteRunnerPhoto, setRunnerPhotoIncluded } from "@/lib/runnerPhotos/service";
import { RunnerPhotoError } from "@/lib/runnerPhotos/types";
import { parseIncluded } from "@/lib/runnerPhotos/validation";

export const dynamic = "force-dynamic";

const { OPTIONS, reject } = photoMethods("DELETE, OPTIONS, PATCH");
export { OPTIONS, reject as GET, reject as HEAD, reject as PUT, reject as POST };

export function PATCH(request: Request, context: PhotoContext) {
  return photoRoute(context, async (userId, { runnerId, photoId }) => {
    const body = await writeBody(request);
    if (Object.keys(body).length !== 1) throw new RunnerPhotoError("invalid");
    return photoJson(await setRunnerPhotoIncluded(userId, runnerId, photoId, parseIncluded(body.included)));
  });
}

export function DELETE(request: Request, context: PhotoContext) {
  return photoRoute(context, async (userId, { runnerId, photoId }) => {
    await emptyWriteBody(request);
    await deleteRunnerPhoto(userId, runnerId, photoId);
    return new Response(null, { status: 204, headers: privateHeaders });
  });
}
