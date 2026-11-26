import "server-only";
import type { Photo, RunnerWrappedPayload } from "../wrappedPayload";

export function hasWrappedGallery(payload: RunnerWrappedPayload): payload is Extract<RunnerWrappedPayload, { photos: Photo[] }> {
  return "kind" in payload ? payload.kind === "official" : payload.state === "ready";
}

export async function loadPersonalWrappedPhotos(userId: string, runnerId: string): Promise<Photo[] | null> {
  // Keep the same optional-photo budget as the Strava recap.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const slots = await Promise.race([
      import("./service").then(service => service.listIncludedRunnerPhotos(userId, runnerId)).catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1200); }),
    ]);
    if (!slots) return null;
    return slots.flatMap(slot => slot.state === "ready" && slot.included && slot.contentUrl ? [{
      id: slot.id, source: "personal", photo_url: slot.contentUrl,
      bib_number: null, photographer: null, captured_km: null, captured_at: null,
    }] : []);
  } finally {
    clearTimeout(timer);
  }
}

export function mergePersonalRunnerPhotos(payload: RunnerWrappedPayload, photos: Photo[]): RunnerWrappedPayload {
  if (!hasWrappedGallery(payload)) return payload;
  return { ...payload, photos: [...photos, ...payload.photos.filter(photo => photo.source === "organizer")] };
}
