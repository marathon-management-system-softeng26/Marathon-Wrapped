import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWrappedPayloadForUser } from "@/lib/wrappedRouteService";
import { personalPhoto, photo, ready, registration, runnerId } from "./fixtures/stravaWrapped";

const mocks = vi.hoisted(() => ({
  getOfficialWrappedForUser: vi.fn(),
  getStravaWrappedForUser: vi.fn(),
  loadPersonalWrappedPhotos: vi.fn(),
}));

vi.mock("@/lib/officialWrappedService", () => ({ getOfficialWrappedForUser: mocks.getOfficialWrappedForUser }));
vi.mock("@/lib/stravaWrappedService", () => ({ getStravaWrappedForUser: mocks.getStravaWrappedForUser }));
vi.mock("@/lib/runnerPhotos/wrapped", async () => {
  const actual = await vi.importActual<typeof import("@/lib/runnerPhotos/wrapped")>("@/lib/runnerPhotos/wrapped");
  return { ...actual, loadPersonalWrappedPhotos: mocks.loadPersonalWrappedPhotos };
});

describe("wrapped route payload", () => {
  beforeEach(() => {
    mocks.getOfficialWrappedForUser.mockReset();
    mocks.getStravaWrappedForUser.mockReset();
    mocks.loadPersonalWrappedPhotos.mockReset();
  });

  it("uses official stats and merges persisted included personal photos", async () => {
    const official = { kind: "official" as const, registration, result: {
      runnerId, eventId: 1, bib: "A1001", name: "Aina Putri", distance: "5K" as const, status: "finished" as const,
      finishTimeMs: 1_999_000, netTimeMs: 1_990_000, overallRank: 12, division: "F30", divisionRank: 4,
      gender: "F", genderRank: 9, checkpoints: [], sourceUrl: null,
    }, strava: { state: "unavailable" as const }, photos: [photo] };
    mocks.getOfficialWrappedForUser.mockResolvedValue(official);
    mocks.getStravaWrappedForUser.mockRejectedValue(new Error("must not use Strava"));
    mocks.loadPersonalWrappedPhotos.mockResolvedValue([personalPhoto]);

    await expect(getWrappedPayloadForUser("user-1", runnerId)).resolves.toEqual({
      ...official,
      photos: [personalPhoto, photo],
    });
    expect(mocks.getStravaWrappedForUser).not.toHaveBeenCalled();
  });

  it("falls back to the Strava workflow when no official payload is available", async () => {
    mocks.getOfficialWrappedForUser.mockResolvedValue(null);
    mocks.getStravaWrappedForUser.mockResolvedValue(ready);
    mocks.loadPersonalWrappedPhotos.mockResolvedValue([]);

    await expect(getWrappedPayloadForUser("user-1", runnerId)).resolves.toEqual(ready);
  });

  it("keeps official stats and reports when selected photos cannot be read", async () => {
    const official = { kind: "official" as const, registration, result: {
      runnerId, eventId: 1, bib: "A1001", name: "Aina Putri", distance: "5K" as const, status: "finished" as const,
      finishTimeMs: 1_999_000, netTimeMs: 1_990_000, overallRank: 12, division: "F30", divisionRank: 4,
      gender: "F", genderRank: 9, checkpoints: [], sourceUrl: null,
    }, strava: { state: "unavailable" as const }, photos: [photo] };
    mocks.getOfficialWrappedForUser.mockResolvedValue(official);
    mocks.loadPersonalWrappedPhotos.mockResolvedValue(null);

    await expect(getWrappedPayloadForUser("user-1", runnerId)).resolves.toMatchObject({
      kind: "official",
      photos: [photo],
      photoWarning: "Selected photos could not load. Retry your Wrapped to try again.",
    });
  });

  it("does not downgrade an official read failure to Strava data", async () => {
    mocks.getOfficialWrappedForUser.mockRejectedValue(new Error("official database unavailable"));
    mocks.getStravaWrappedForUser.mockResolvedValue(ready);

    await expect(getWrappedPayloadForUser("user-1", runnerId)).rejects.toThrow("official database unavailable");
    expect(mocks.getStravaWrappedForUser).not.toHaveBeenCalled();
  });
});
