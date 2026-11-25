import { beforeEach, describe, expect, it, vi } from "vitest";
import { organizerPhotoRow } from "./fixtures/stravaWrapped";
import { composeOfficialWrapped, getOfficialWrappedForUser, type OfficialRecap } from "@/lib/officialWrappedService";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getStravaWrappedForUser: vi.fn(),
  getWrappedForUser: vi.fn(),
}));

vi.mock("@/lib/supabaseServer", () => ({
  getSupabaseAdmin: () => ({ from: mocks.from }),
}));

vi.mock("@/lib/stravaWrappedService", () => ({
  getStravaWrappedForUser: mocks.getStravaWrappedForUser,
}));
vi.mock("@/lib/wrappedService", () => ({ getWrappedForUser: mocks.getWrappedForUser }));

const registration = {
  runner: { id: "00000000-0000-4000-8000-000000000001", name: "Runner One", bibNumber: "00123" },
  event: { name: "Soekarno Run", date: "2027-08-17", category: "5K" },
};

const result: OfficialRecap = {
  runnerId: "00000000-0000-4000-8000-000000000001",
  eventId: 7,
  bib: "00123",
  name: "Runner One",
  distance: "5K",
  status: "finished",
  finishTimeMs: 2005213,
  netTimeMs: 1999000,
  overallRank: 12,
  division: "M30",
  divisionRank: 4,
  gender: "M",
  genderRank: 9,
  checkpoints: [{ sequence: 1, label: "5K", distanceMeters: 5000, displayedTimeMs: 2005213, reportedSplitMs: 2005213, referenceLabel: "Finish" }],
  sourceUrl: "https://example.invalid/result/1",
};

describe("composeOfficialWrapped", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.getStravaWrappedForUser.mockReset();
    mocks.getWrappedForUser.mockReset();
  });

  it("keeps official timing and provenance independent of Strava", () => {
    const payload = composeOfficialWrapped(registration, result, { state: "unavailable" }, []);
    expect(payload.kind).toBe("official");
    expect(payload.registration).toEqual(registration);
    expect(payload.result.finishTimeMs).toBe(2005213);
    expect(payload.result.checkpoints[0].reportedSplitMs).toBe(2005213);
    expect(payload.strava).toEqual({ state: "unavailable" });
  });

  it("does not invent timing for non-finishers", () => {
    const payload = composeOfficialWrapped(registration, { ...result, status: "dnf", finishTimeMs: null, netTimeMs: null, overallRank: null }, { state: "unavailable" }, []);
    expect(payload.result.finishTimeMs).toBeNull();
    expect(payload.result.overallRank).toBeNull();
  });

  it("loads registration independently when optional Strava storage is unavailable", async () => {
    mocks.getStravaWrappedForUser.mockRejectedValue(new Error("Strava unavailable"));
    mocks.from.mockImplementation((table: string) => {
      if (table === "official_race_results") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  runner_id: result.runnerId,
                  event_id: result.eventId,
                  bib: result.bib,
                  name: result.name,
                  distance: result.distance,
                  status: result.status,
                  finish_time_ms: result.finishTimeMs,
                  net_time_ms: result.netTimeMs,
                  overall_rank: result.overallRank,
                  division: result.division,
                  division_rank: result.divisionRank,
                  gender: result.gender,
                  gender_rank: result.genderRank,
                  source_url: result.sourceUrl,
                  official_race_checkpoints: [],
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "runners") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: registration.runner.id,
                  name: registration.runner.name,
                  bib_number: registration.runner.bibNumber,
                  categories: {
                    name: registration.event.category,
                    events: { name: registration.event.name, event_date: registration.event.date },
                  },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "fotoyu_photos") {
        return {
          select: () => ({
            eq: async () => ({ data: [{ ...organizerPhotoRow, bib_number: result.bib, photographer: null }], error: null }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const payload = await getOfficialWrappedForUser("user-1", result.runnerId, true);

    expect(payload?.registration).toEqual(registration);
    expect(payload?.photos).toEqual([{ ...organizerPhotoRow, bib_number: result.bib, photographer: null, source: "organizer" }]);
    expect(payload?.strava).toEqual({ state: "unavailable" });
  });

  it("adapts a legacy chip result when official publication tables are unavailable", async () => {
    mocks.getWrappedForUser.mockResolvedValue({ status: "dnf", stats: {
      runner_id: result.runnerId, bib_number: "00123", name: "Runner One", gender: "M", age: 30,
      event: "Soekarno Run", category: "5K", distance_km: 5, start_status: "on-time", elapsed_seconds: null,
      avg_pace_sec_km: null, category_rank: null, overall_rank: null, category_percentile: null, finisher: false,
      splits: [], fastest_km: null, split_type: null, first_half_seconds: null, second_half_seconds: null, slowed_after_km: null, insights: [],
    }, strava: { state: "unavailable", metrics: null }, photos: [], warnings: [] });
    mocks.getStravaWrappedForUser.mockRejectedValue(new Error("not configured"));
    mocks.from.mockImplementation((table: string) => {
      if (table === "official_race_results") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "missing relation" } }) }) }) };
      if (table === "runners") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: registration.runner.id, name: registration.runner.name, bib_number: registration.runner.bibNumber, categories: { name: registration.event.category, events: { name: registration.event.name, event_date: registration.event.date } } }, error: null }) }) }) };
      throw new Error(`Unexpected table ${table}`);
    });

    const payload = await getOfficialWrappedForUser("user-1", result.runnerId, true);
    expect(payload).toMatchObject({ kind: "official", result: { status: "dnf", finishTimeMs: null }, registration });
  });
});
