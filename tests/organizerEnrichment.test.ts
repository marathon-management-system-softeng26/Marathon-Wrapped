import { describe, it, expect } from "vitest";
import { validateOrganizerEnrichment } from "@/lib/organizerEnrichment";
const origin = "https://example.supabase.co";
const photo = {
  photo_url: origin + "/storage/v1/object/public/race-photos/demo.jpg",
  photographer: "Sample CC0",
  captured_km: null,
  captured_at: null,
};
describe("organizer sample enrichment boundary", () => {
  it("accepts nullable sample metrics and owned photo mappings, stripping other fields", () => {
    const draft = validateOrganizerEnrichment(
      {
        metrics: {
          avg_heartrate: 150,
          max_heartrate: null,
          elevation_gain_m: 0,
          calories: 400,
          avg_cadence: 80,
          access_token: "never",
        },
        photos: [{ ...photo, bib_number: "other" }],
      },
      5,
      origin,
    );
    expect(draft.metrics?.avg_heartrate).toBe(150);
    expect(draft.metrics).not.toHaveProperty("access_token");
    expect(draft.photos[0]).not.toHaveProperty("bib_number");
  });
  it.each([-1, Infinity, NaN, 1000, "150"])(
    "rejects invalid heart rate %s",
    (value) => {
      expect(() =>
        validateOrganizerEnrichment(
          { metrics: { avg_heartrate: value }, photos: [] },
          5,
          origin,
        ),
      ).toThrow();
    },
  );
  it("allows explicit removal of demo metrics and photos", () => {
    expect(
      validateOrganizerEnrichment({ metrics: null, photos: [] }, 5, origin),
    ).toEqual({ metrics: null, photos: [] });
  });
  it.each([
    "https://tracker.example/p.jpg",
    origin + "/auth/v1/token",
    origin + "/storage/v1/object/public/race-photos/a.jpg?token=private",
  ])("rejects untrusted photo URL %s", (url) => {
    expect(() =>
      validateOrganizerEnrichment(
        { metrics: null, photos: [{ ...photo, photo_url: url }] },
        5,
        origin,
      ),
    ).toThrow();
  });
  it("rejects a photo marker beyond the selected category", () => {
    expect(() =>
      validateOrganizerEnrichment(
        { metrics: null, photos: [{ ...photo, captured_km: 6 }] },
        5,
        origin,
      ),
    ).toThrow();
  });
});
