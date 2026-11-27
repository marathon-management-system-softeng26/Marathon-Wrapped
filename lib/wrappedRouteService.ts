import "server-only";
import { getOfficialWrappedForUser } from "./officialWrappedService";
import { hasWrappedGallery, loadPersonalWrappedPhotos, mergePersonalRunnerPhotos } from "./runnerPhotos/wrapped";
import { getStravaWrappedForUser } from "./stravaWrappedService";
import type { RunnerWrappedPayload } from "./wrappedPayload";

export async function getWrappedPayloadForUser(userId: string, runnerId: string): Promise<RunnerWrappedPayload> {
  let payload: RunnerWrappedPayload | null = null;
  try {
    payload = await getOfficialWrappedForUser(userId, runnerId);
  } catch {
    // Additive official-result deployments can be missing their tables; retain the Strava fallback.
  }
  if (!payload) payload = await getStravaWrappedForUser(userId, runnerId);
  if (hasWrappedGallery(payload)) {
    const photos = await loadPersonalWrappedPhotos(userId, runnerId);
    if (photos) payload = mergePersonalRunnerPhotos(payload, photos);
  }
  return payload;
}
