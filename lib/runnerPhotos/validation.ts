import { isRunnerId } from "../runnerValidation";
import { MAX_PHOTO_BYTES, PHOTO_MIME_TYPES, RunnerPhotoError, type UploadDeclaration } from "./types";

export function parsePhotoId(value: unknown): string {
  if (typeof value !== "string" || !isRunnerId(value)) throw new RunnerPhotoError("invalid");
  return value;
}

export function parseIncluded(value: unknown): boolean {
  if (typeof value !== "boolean") throw new RunnerPhotoError("invalid");
  return value;
}

export function validPhotoSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PHOTO_BYTES;
}

export function parseUploadDeclaration(value: unknown): UploadDeclaration {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 2 || !Object.hasOwn(value, "mimeType") || !Object.hasOwn(value, "sizeBytes")) {
    throw new RunnerPhotoError("invalid");
  }
  const { mimeType, sizeBytes } = value as Record<string, unknown>;
  const mime = PHOTO_MIME_TYPES.find(allowed => mimeType === allowed);
  if (!mime || !validPhotoSize(sizeBytes)) throw new RunnerPhotoError("invalid");
  return { mimeType: mime, sizeBytes };
}
