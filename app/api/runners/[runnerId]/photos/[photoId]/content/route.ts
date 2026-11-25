import { privateHeaders } from "@/lib/authHttp";
import { photoRoute, type PhotoContext } from "@/lib/runnerPhotos/http";
import { readRunnerPhoto } from "@/lib/runnerPhotos/service";

export const dynamic = "force-dynamic";

export function GET(_request: Request, context: PhotoContext) {
  return photoRoute(context, async (userId, { runnerId, photoId }) => {
    const bytes = await readRunnerPhoto(userId, runnerId, photoId);
    return new Response(new Uint8Array(bytes), { headers: {
      ...privateHeaders,
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.byteLength),
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    } });
  });
}
