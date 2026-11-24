export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export type UploadDeclaration = { mimeType: typeof PHOTO_MIME_TYPES[number]; sizeBytes: number };
export type RunnerPhotoState = "pending" | "finalizing" | "ready";

export interface RunnerPhotoSlot {
  id: string;
  state: RunnerPhotoState;
  included: boolean;
  createdAt: string;
  expiresAt: string | null;
  contentUrl: string | null;
}

export interface RunnerPhotoUploadCapability {
  photoId: string;
  path: string;
  token: string;
  expiresAt: string;
}

const messages = {
  invalid: "Invalid photo input.",
  not_found: "Photo not found.",
  quota: "All three photo slots are in use.",
  in_progress: "Photo completion is in progress.",
  unavailable: "Photo service unavailable.",
} as const;

export class RunnerPhotoError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
    this.name = "RunnerPhotoError";
  }
}
