import "server-only";
import { getOfficialWrappedForUser } from "./officialWrappedService";
import { hasWrappedGallery, loadPersonalWrappedPhotos, mergePersonalRunnerPhotos } from "./runnerPhotos/wrapped";
import { getStravaWrappedForUser } from "./stravaWrappedService";
import type { RunnerWrappedPayload } from "./wrappedPayload";

export async function getWrappedPayloadForUser(userId: string, runnerId: string): Promise<RunnerWrappedPayload> {
  const official = await getOfficialWrappedForUser(userId, runnerId);
  let payload: RunnerWrappedPayload | null = official;
  if (!payload) payload = await getStravaWrappedForUser(userId, runnerId);
  if (hasWrappedGallery(payload)) {
    const photos = await loadPersonalWrappedPhotos(userId, runnerId);
    if (photos) payload = mergePersonalRunnerPhotos(payload, photos);
    else payload = { ...payload, photoWarning: "Selected photos could not load. Retry your Wrapped to try again." };
  }
  return payload;
}
