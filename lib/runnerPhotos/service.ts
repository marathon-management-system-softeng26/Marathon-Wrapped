import "server-only";
import sharp from "sharp";
import * as store from "./store";
import * as storage from "./storage";
import { RunnerPhotoError, type RunnerPhotoSlot, type RunnerPhotoUploadCapability, type UploadDeclaration } from "./types";
import { parseIncluded, parsePhotoId, parseUploadDeclaration, validPhotoSize } from "./validation";

const maxEdge = 4096;
const expiresIn = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

function invalid(): never { throw new RunnerPhotoError("invalid"); }

// Decoders may silently ignore bytes after the first image. Find the real JPEG
// terminator, skipping length-delimited metadata and byte-stuffed scan data.
function checkJpegEnd(bytes: Buffer) {
  let offset = 2;
  let scanning = false;
  while (offset < bytes.length) {
    if (scanning) offset = bytes.indexOf(0xff, offset);
    if (offset < 0 || bytes[offset] !== 0xff) invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (scanning && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
    if (marker === 0xd9) {
      if (offset !== bytes.length) invalid();
      return;
    }
    if (offset + 2 > bytes.length) invalid();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || length > bytes.length - offset) invalid();
    offset += length;
    scanning = marker === 0xda;
  }
  invalid();
}

// Some libpng builds decode just the first frame of an APNG.
function checkPngEnd(bytes: Buffer) {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    if (type === "acTL" || type === "fcTL" || type === "fdAT") invalid();
    offset += 12 + length;
    if (type === "IEND") {
      if (length !== 0 || offset !== bytes.length) invalid();
      return;
    }
  }
  invalid();
}

function imageFormat(bytes: Buffer) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    checkJpegEnd(bytes);
    return "jpeg";
  }
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    checkPngEnd(bytes);
    return "png";
  }
  if (bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP" &&
      bytes.readUInt32LE(4) + 8 === bytes.length) return "webp";
  return invalid();
}

export async function normalizeRunnerPhoto(input: Uint8Array, expectedMime?: UploadDeclaration["mimeType"]) {
  if (!validPhotoSize(input.byteLength)) invalid();
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  try {
    const format = imageFormat(bytes);
    if (expectedMime && expectedMime !== "image/" + format) invalid();
    const decoder = sharp(bytes, { failOn: "warning", limitInputPixels: maxEdge * maxEdge });
    const metadata = await decoder.metadata();
    if (format === "webp" && (metadata.loop !== undefined || metadata.delay !== undefined)) invalid();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1 ||
        metadata.width * metadata.height > maxEdge * maxEdge) invalid();
    const normalized = await decoder.rotate().resize({
      width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true,
    }).webp().toBuffer();
    if (!validPhotoSize(normalized.length)) invalid();
    return { bytes: normalized, mimeType: "image/webp" as const, sizeBytes: normalized.length };
  } catch {
    return invalid();
  }
}

async function authorize(userId: string, runnerId: string, photoId?: string) {
  parsePhotoId(userId);
  parsePhotoId(runnerId);
  if (photoId !== undefined) parsePhotoId(photoId);
  await store.requirePhotoOwner(userId, runnerId);
}

async function list(userId: string, runnerId: string, includedOnly: boolean) {
  await authorize(userId, runnerId);
  await storage.privatePhotoBucket();
  return store.listSlots(userId, runnerId, includedOnly);
}

export function listRunnerPhotos(userId: string, runnerId: string): Promise<RunnerPhotoSlot[]> {
  return list(userId, runnerId, false);
}

export function listIncludedRunnerPhotos(userId: string, runnerId: string): Promise<RunnerPhotoSlot[]> {
  return list(userId, runnerId, true);
}

export async function beginRunnerPhotoUpload(userId: string, runnerId: string, input: unknown): Promise<RunnerPhotoUploadCapability> {
  const declaration = parseUploadDeclaration(input);
  await authorize(userId, runnerId);
  const bucket = await storage.privatePhotoBucket();
  const deadline = expiresIn(180);
  const reservation = await store.reserveUpload(store.ownerArgs(userId, runnerId), declaration, deadline);
  if (!reservation) {
    // The RPC also returns no row if ownership changed while we were reserving.
    await store.requirePhotoOwner(userId, runnerId);
    throw new RunnerPhotoError("quota");
  }
  const { photo_id: photoId, staging_object_path: path } = reservation;
  const photo = store.photoArgs(userId, runnerId, photoId);
  try {
    if (Date.parse(expiresIn(120)) >= Date.parse(deadline)) throw new RunnerPhotoError("unavailable");
    const { token, expiresAt } = await storage.signStaging(bucket, path);
    if (!await store.activateUpload(photo, expiresAt)) throw new RunnerPhotoError("not_found");
    return { photoId, path, token, expiresAt };
  } catch (error) {
    // Deletion enqueues the staging tombstone. If it fails, expiry still sweeps it.
    await store.deletePhoto(photo).catch(() => false);
    throw error;
  }
}

function completedOrPending(row: store.PhotoRow, runnerId: string) {
  const slot = store.toSlot(row, runnerId);
  if (slot.state === "ready") return slot;
  if (!row.upload_expires_at || Date.parse(row.upload_expires_at) <= Date.now()) throw new RunnerPhotoError("not_found");
  if (slot.state === "finalizing") throw new RunnerPhotoError("in_progress");
  return null;
}

export async function completeRunnerPhotoUpload(userId: string, runnerId: string, photoId: string): Promise<RunnerPhotoSlot> {
  await authorize(userId, runnerId, photoId);
  const row = await store.ownedPhoto(userId, runnerId, photoId);
  const bucket = await storage.privatePhotoBucket();
  const completed = completedOrPending(row, runnerId);
  if (completed) return completed;
  await storage.checkStagingInfo(bucket, row.staging_object_path, { mimeType: row.input_mime_type, sizeBytes: row.input_size_bytes });
  const input = await storage.boundedDownload(bucket, row.staging_object_path, row.input_size_bytes);
  const normalized = await normalizeRunnerPhoto(input, row.input_mime_type);

  const photo = store.photoArgs(userId, runnerId, photoId);
  const lease = await store.prepareReady(photo, expiresIn(10));
  if (!lease) {
    const latest = await store.ownedPhoto(userId, runnerId, photoId);
    const slot = completedOrPending(latest, runnerId);
    if (slot) return slot;
    throw new RunnerPhotoError("not_found");
  }
  // Never initiate a new write on a lease that expired while its response was in flight.
  if (Date.parse(lease.lease_expires_at) <= Date.now()) throw new RunnerPhotoError("in_progress");
  await storage.uploadNormalized(bucket, lease.ready_object_path, normalized.bytes);
  if (!await store.finalizeUpload(photo, lease, normalized.sizeBytes)) throw new RunnerPhotoError("not_found");
  return store.toSlot(await store.ownedPhoto(userId, runnerId, photoId, true), runnerId);
}

export async function setRunnerPhotoIncluded(userId: string, runnerId: string, photoId: string, included: boolean): Promise<RunnerPhotoSlot> {
  const value = parseIncluded(included);
  await authorize(userId, runnerId, photoId);
  await storage.privatePhotoBucket();
  if (!await store.setIncluded(store.photoArgs(userId, runnerId, photoId), value)) throw new RunnerPhotoError("not_found");
  return store.toSlot(await store.ownedPhoto(userId, runnerId, photoId, true), runnerId);
}

export async function deleteRunnerPhoto(userId: string, runnerId: string, photoId: string): Promise<void> {
  await authorize(userId, runnerId, photoId);
  // Revocation and cleanup enqueue must remain available during a Storage outage.
  if (!await store.deletePhoto(store.photoArgs(userId, runnerId, photoId))) throw new RunnerPhotoError("not_found");
}

export async function readRunnerPhoto(userId: string, runnerId: string, photoId: string): Promise<Uint8Array> {
  await authorize(userId, runnerId, photoId);
  const row = await store.ownedPhoto(userId, runnerId, photoId, true);
  if (!row.ready_object_path || !row.ready_size_bytes) throw new RunnerPhotoError("not_found");
  return storage.downloadReady(await storage.privatePhotoBucket(), row.ready_object_path, row.ready_size_bytes);
}
