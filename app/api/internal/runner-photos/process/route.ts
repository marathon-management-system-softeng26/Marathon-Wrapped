import { timingSafeEqual } from "node:crypto";
import { processRunnerPhotoCleanup } from "@/lib/runnerPhotos/cleanup";
import { photoJson, photoMethods } from "@/lib/runnerPhotos/http";

export const maxDuration = 60;

const { OPTIONS, reject } = photoMethods("OPTIONS, POST");
export { OPTIONS, reject as GET, reject as HEAD, reject as PUT, reject as PATCH, reject as DELETE };

export async function POST(request: Request) {
  const secret = process.env.RUNNER_PHOTO_PROCESS_SECRET;
  if (!secret) return photoJson({ error: "Photo worker is not configured." }, 503);

  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return photoJson({ error: "Unauthorized." }, 401);
  }

  try {
    return photoJson(await processRunnerPhotoCleanup());
  } catch {
    return photoJson({ error: "Photo service unavailable." }, 503);
  }
}
