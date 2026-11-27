import { beforeEach, describe, expect, it, vi } from "vitest";
import { photo, registration as publishedRegistration, runnerId } from "./fixtures/stravaWrapped";
import { ownerId, publishedOfficialDatabase } from "./fixtures/stravaWrappedDatabase";
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

  it("loads the published registration and only its organizer photo when Strava is unavailable and another runner has the displayed BIB", async () => {
    const { client, requests } = publishedOfficialDatabase();
    mocks.from.mockImplementation(client.from.bind(client));
    mocks.getStravaWrappedForUser.mockRejectedValue(new Error("Strava unavailable"));

    const payload = await getOfficialWrappedForUser(ownerId, runnerId);

    expect(payload?.registration).toEqual(publishedRegistration);
    expect(payload?.photos).toStrictEqual([{ ...photo, bib_number: null, photographer: null }]);
    expect(requests.find(url => url.pathname.endsWith("/fotoyu_photos"))?.searchParams.get("order"))
      .toBe("captured_at.asc.nullslast,id.asc");
    expect(payload?.strava).toEqual({ state: "unavailable" });
  });

  it("uses persisted estimated per-kilometer splits when present", async () => {
    const db = publishedOfficialDatabase();
    const row = db.tables.official_race_results.at(-1)!;
    row.mock_splits = [
      { kilometer: 1, distanceMeters: 1_000, splitSeconds: 300, elapsedSeconds: 300 },
      { kilometer: 2, distanceMeters: 2_000, splitSeconds: 310, elapsedSeconds: 610 },
    ];
    mocks.from.mockImplementation(db.client.from.bind(db.client));
    mocks.getStravaWrappedForUser.mockRejectedValue(new Error("Strava unavailable"));

    const payload = await getOfficialWrappedForUser(ownerId, runnerId);

    expect(payload?.result.checkpoints).toEqual([
      { sequence: 1, label: "Km 1", distanceMeters: 1_000, displayedTimeMs: 300_000, reportedSplitMs: 300_000, referenceLabel: "Estimated mock split", isMock: true },
      { sequence: 2, label: "Km 2", distanceMeters: 2_000, displayedTimeMs: 610_000, reportedSplitMs: 310_000, referenceLabel: "Estimated mock split", isMock: true },
    ]);
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
