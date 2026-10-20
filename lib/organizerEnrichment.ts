import type { StravaMetrics } from "./wrappedPayload";
import { HeroValidationError } from "./heroErrors";
export type DemoPhotoDraft = {
  photo_url: string;
  photographer: string | null;
  captured_km: number | null;
  captured_at: string | null;
};
export type OrganizerEnrichment = {
  metrics: StravaMetrics | null;
  photos: DemoPhotoDraft[];
};
function fail(): never {
  throw new HeroValidationError(
    "Check sample metrics and photo links. Photos must use this project's race-photos bucket.",
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
export function validateOrganizerEnrichment(
  value: unknown,
  distance: number,
  photoOrigin: string,
): OrganizerEnrichment {
  const row = record(value);
  let metrics: StravaMetrics | null = null;
  if (row.metrics !== null) {
    const raw = record(row.metrics);
    const number = (
      key: string,
      min: number,
      max: number,
      integer = false,
    ): number | null => {
      const v = raw[key];
      if (v === undefined || v === null) return null;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < min ||
        v > max ||
        (integer && !Number.isInteger(v))
      )
        fail();
      return v;
    };
    metrics = {
      avg_heartrate: number("avg_heartrate", 1, 300, true),
      max_heartrate: number("max_heartrate", 1, 300, true),
      elevation_gain_m: number("elevation_gain_m", 0, 99999.99),
      calories: number("calories", 0, 2147483647, true),
      avg_cadence: number("avg_cadence", 0, 300, true),
    };
    if (
      metrics.avg_heartrate !== null &&
      metrics.max_heartrate !== null &&
      metrics.max_heartrate < metrics.avg_heartrate
    )
      fail();
  }
  if (!Array.isArray(row.photos) || row.photos.length > 100) fail();
  const photos = row.photos.map((value) => {
    const photo = record(value);
    if (typeof photo.photo_url !== "string" || photo.photo_url.length > 2048)
      fail();
    let url: URL;
    try {
      url = new URL(photo.photo_url);
    } catch {
      fail();
    }
    if (
      url.protocol !== "https:" ||
      url.origin !== photoOrigin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith("/storage/v1/object/public/race-photos/") ||
      url.pathname.endsWith("/")
    )
      fail();
    if (
      photo.photographer !== null &&
      (typeof photo.photographer !== "string" ||
        photo.photographer.length > 200)
    )
      fail();
    const km = photo.captured_km;
    if (
      km !== null &&
      (typeof km !== "number" ||
        !Number.isInteger(km) ||
        km < 0 ||
        km > distance)
    )
      fail();
    const at = photo.captured_at;
    if (
      at !== null &&
      (typeof at !== "string" ||
        at.length > 40 ||
        !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(at) ||
        !Number.isFinite(Date.parse(at)))
    )
      fail();
    return {
      photo_url: url.href,
      photographer: photo.photographer as string | null,
      captured_km: km as number | null,
      captured_at: at as string | null,
    };
  });
  return { metrics, photos };
}
