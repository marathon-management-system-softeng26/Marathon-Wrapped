import { privateHeaders } from "@/lib/authHttp";
import { photoMethods, photoRoute, type PhotoContext } from "@/lib/runnerPhotos/http";
import { readRunnerPhoto } from "@/lib/runnerPhotos/service";
import { RunnerPhotoError } from "@/lib/runnerPhotos/types";

export const dynamic = "force-dynamic";

const { OPTIONS, reject } = photoMethods("GET, HEAD, OPTIONS");
export { OPTIONS, reject as PUT, reject as POST, reject as PATCH, reject as DELETE };

export function GET(_request: Request, context: PhotoContext) {
  return photoRoute(context, async (userId, { runnerId, photoId }) => {
    const bytes = await readRunnerPhoto(userId, runnerId, photoId).catch(error => {
      // Route IDs are validated. The ready object's length comes from private metadata.
      if (error instanceof RunnerPhotoError && error.code === "invalid") throw new RunnerPhotoError("unavailable");
      throw error;
    });
    return new Response(new Uint8Array(bytes), { headers: {
      ...privateHeaders,
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.byteLength),
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    } });
  });
}
