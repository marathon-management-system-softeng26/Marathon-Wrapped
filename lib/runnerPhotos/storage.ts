import "server-only";
import { StorageApiError } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../supabaseServer";
import { backendData } from "./store";
import { MAX_PHOTO_BYTES, PHOTO_MIME_TYPES, RunnerPhotoError, type UploadDeclaration } from "./types";
import { validPhotoSize } from "./validation";

const bucketName = "runner-photos";

export async function privatePhotoBucket() {
  const bucket = await backendData(() => getSupabaseAdmin().storage.getBucket(bucketName));
  if (!bucket || bucket.id !== bucketName || bucket.name !== bucketName || bucket.public !== false ||
      bucket.file_size_limit !== MAX_PHOTO_BYTES || bucket.allowed_mime_types?.length !== PHOTO_MIME_TYPES.length ||
      !PHOTO_MIME_TYPES.every(mime => bucket.allowed_mime_types?.includes(mime))) {
    throw new RunnerPhotoError("unavailable");
  }
  return getSupabaseAdmin().storage.from(bucketName);
}

type Bucket = Awaited<ReturnType<typeof privatePhotoBucket>>;

export async function signStaging(bucket: Bucket, stagingPath: string) {
  const data = await backendData(() => bucket.createSignedUploadUrl(stagingPath, { upsert: false }));
  if (!data?.token || data.path !== stagingPath) throw new RunnerPhotoError("unavailable");
  // Read only the expiry from the authenticated Storage response. No client
  // supplies this token and its contents never authorize application operations.
  const parts = data.token.split(".");
  if (parts.length !== 3) throw new RunnerPhotoError("unavailable");
  try {
    const { exp } = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (!Number.isSafeInteger(exp) || exp * 1000 <= Date.now()) throw new Error();
    return { token: data.token, expiresAt: new Date(exp * 1000).toISOString() };
  } catch {
    throw new RunnerPhotoError("unavailable");
  }
}

export async function checkStagingInfo(bucket: Bucket, path: string, expected: UploadDeclaration) {
  const data = await backendData(() => bucket.info(path));
  if (!data || data.size !== expected.sizeBytes || data.contentType !== expected.mimeType ||
      !validPhotoSize(data.size)) throw new RunnerPhotoError("invalid");
}

export async function boundedDownload(bucket: Bucket, path: string, expectedSize: number) {
  if (!validPhotoSize(expectedSize)) throw new RunnerPhotoError("invalid");
  const stream = await backendData(() => bucket.download(path, {}, { cache: "no-store" }).asStream());
  if (!stream) throw new RunnerPhotoError("unavailable");
  const reader = stream.getReader();
  const bytes = Buffer.allocUnsafe(expectedSize);
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.byteLength > expectedSize - length) {
        await reader.cancel();
        throw new RunnerPhotoError("invalid");
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
  } catch (error) {
    if (error instanceof RunnerPhotoError) throw error;
    throw new RunnerPhotoError("unavailable");
  } finally {
    reader.releaseLock();
  }
  if (length !== expectedSize) throw new RunnerPhotoError("invalid");
  return bytes;
}

export async function uploadNormalized(bucket: Bucket, path: string, bytes: Buffer) {
  await backendData(() => bucket.upload(path, bytes, { contentType: "image/webp", cacheControl: "0", upsert: false }));
}

export async function downloadReady(bucket: Bucket, path: string, sizeBytes: number) {
  return boundedDownload(bucket, path, sizeBytes);
}

// Call only after a due outbox job has been claimed.
export async function removePhotoObject(path: string): Promise<void> {
  const bucket = await privatePhotoBucket();
  await backendData(async () => {
    const result = await bucket.remove([path]);
    if (result.error instanceof StorageApiError && ["NoSuchKey", "ObjectNotFound"].includes(result.error.code ?? "")) {
      return { data: null, error: null };
    }
    return result;
  });
}
