import { afterEach, describe, expect, it, vi } from "vitest";
import { candidate, ready, registration, runnerId, snapshot } from "./fixtures/stravaWrapped";
import { organizerId, ownerId, wrappedDatabase } from "./fixtures/stravaWrappedDatabase";

const mocks = vi.hoisted(() => ({ db: vi.fn(), chip: vi.fn(), summary: vi.fn() }));
vi.mock("@/lib/supabaseServer", () => ({ getSupabaseAdmin: mocks.db }));
vi.mock("@/controllers/runnerController", () => ({ getRunnerChipInput: mocks.chip, getRunnerSummary: mocks.summary }));

import { getStravaWrappedForUser as getWrapped } from "@/lib/stravaWrappedService";

afterEach(() => vi.unstubAllGlobals());

describe("stored Strava Wrapped service", () => {
  it("returns a ready snapshot without reading chip data, provider APIs or legacy enrichment", async () => {
    const db = wrappedDatabase();
    mocks.db.mockReturnValue(db.client);
    const provider = vi.fn(() => { throw new Error("Wrapped must use stored data"); });
    vi.stubGlobal("fetch", provider);
    expect(await getWrapped(ownerId, runnerId)).toStrictEqual(ready);
    expect(provider).not.toHaveBeenCalled();
    expect(mocks.chip).not.toHaveBeenCalled();
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(db.requests.map((url) => url.pathname)).not.toContain("/rest/v1/strava_live_metrics");
    expect(db.requests.map((url) => url.searchParams.get("select"))).not.toContain("*");
    expect(db.requests.map((url) => url.href).join("\n")).not.toMatch(/access_token|refresh_token/);
  });

  it("rejects organizer access before reading any Strava or photo data", async () => {
    const db = wrappedDatabase();
    mocks.db.mockReturnValue(db.client);
    await expect(getWrapped(organizerId, runnerId)).rejects.toMatchObject({ name: "AccessDeniedError" });
    expect(db.requests.map((url) => url.pathname)).toEqual(["/rest/v1/runner_access"]);
  });

  it.each([{ photoError: true }, { noPhotos: true }])("keeps a ready snapshot when BIB photos are unavailable (%o)", async (options) => {
    mocks.db.mockReturnValue(wrappedDatabase("ready", options).client);
    expect(await getWrapped(ownerId, runnerId)).toStrictEqual({ ...ready, photos: [] });
  });

  it("settles a stalled photo read independently of the ready snapshot", async () => {
    vi.useFakeTimers();
    try {
      mocks.db.mockReturnValue(wrappedDatabase("ready", { stalledPhotos: true }).client);
      const result = getWrapped(ownerId, runnerId);
      await vi.advanceTimersByTimeAsync(1200);
      await expect(result).resolves.toStrictEqual({ ...ready, photos: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops photos for the old BIB when the registration changes during the read", async () => {
    mocks.db.mockReturnValue(wrappedDatabase("ready", { changeBibDuringRead: true }).client);
    expect(await getWrapped(ownerId, runnerId)).toStrictEqual({
      ...ready, registration: { ...registration, runner: { ...registration.runner, bibNumber: "A2002" } }, photos: [],
    });
  });

  it("uses current registration identity and skips photo lookup if the runner has no BIB", async () => {
    const db = wrappedDatabase("ready", { noBib: true });
    mocks.db.mockReturnValue(db.client);
    expect(await getWrapped(ownerId, runnerId)).toStrictEqual({
      ...ready, registration: { ...registration, runner: { ...registration.runner, bibNumber: null } }, photos: [],
    });
    expect(db.requests.map((url) => url.pathname)).not.toContain("/rest/v1/fotoyu_photos");
  });

  it("never serves a legacy ready row with extra nested provider fields", async () => {
    mocks.db.mockReturnValue(wrappedDatabase("ready", {
      snapshotPayload: { ...snapshot, splits: [{ ...snapshot.splits[0], coordinates: [-6.1, 106.5] }] },
    }).client);
    expect(await getWrapped(ownerId, runnerId)).toStrictEqual({ state: "failed", registration });
  });

  it("never serves a ready V1 snapshot stored against the wrong runner identity", async () => {
    mocks.db.mockReturnValue(wrappedDatabase("ready", {
      snapshotPayload: { ...snapshot, runner: { ...snapshot.runner, id: organizerId } },
    }).client);
    expect(await getWrapped(ownerId, runnerId)).toStrictEqual({ state: "failed", registration });
  });

  it.each([{ missingSnapshot: true }, { snapshotVersion: 2 }])("waits for the selected version 1 snapshot (%o)", async (options) => {
    mocks.db.mockReturnValue(wrappedDatabase("ready", options).client);
    expect(await getWrapped(ownerId, runnerId)).toStrictEqual({ state: "building", registration });
  });

  it("returns only the owned candidate's projected confirmation data", async () => {
    mocks.db.mockReturnValue(wrappedDatabase("needs_confirmation").client);
    expect(await getWrapped(ownerId, runnerId)).toStrictEqual({ state: "needs_confirmation", registration, candidates: [candidate] });
  });

  it("omits a stored candidate whose activity is attributed to another athlete", async () => {
    mocks.db.mockReturnValue(wrappedDatabase("needs_confirmation", { invalidCandidate: true }).client);
    expect(await getWrapped(ownerId, runnerId)).toStrictEqual({ state: "no_match", registration });
  });

  it.each(["removed", "reclassified"] as const)("withholds a candidate %s before the final confirmation read", async (change) => {
    const db = wrappedDatabase("needs_confirmation", { candidateChangeBeforeFence: change });
    mocks.db.mockReturnValue(db.client);

    expect(await getWrapped(ownerId, runnerId)).toStrictEqual({ state: "no_match", registration });
    expect(db.requests.map((url) => url.pathname).filter((path) => path.includes("candidate") || path.includes("confirmation")))
      .toEqual(["/rest/v1/rpc/strava_wrapped_confirmation"]);
    expect(db.requests.at(-1)?.pathname).toBe("/rest/v1/rpc/strava_wrapped_confirmation");
  });

  it("replaces an unknown candidate reason with safe confirmation copy", async () => {
    mocks.db.mockReturnValue(wrappedDatabase("needs_confirmation", { unknownCandidateReason: true }).client);
    expect(await getWrapped(ownerId, runnerId)).toStrictEqual({
      state: "needs_confirmation", registration,
      candidates: [{ ...candidate, gpsAvailable: true, matchReason: "confirmation_required" }],
    });
  });

  it.each([["no_match", "failed"], ["importing", "importing"]] as const)(
    "uses current import job state when the registration would otherwise be %s",
    async (initialState, state) => {
      mocks.db.mockReturnValue(wrappedDatabase(initialState, { currentFailedImport: true }).client);
      expect(await getWrapped(ownerId, runnerId)).toStrictEqual({ state, registration });
    },
  );

  it("rejects a ready snapshot when direct ownership disappears during the read", async () => {
    mocks.db.mockReturnValue(wrappedDatabase("ready", { revokeAccessDuringRead: true }).client);
    await expect(getWrapped(ownerId, runnerId)).rejects.toMatchObject({ name: "AccessDeniedError" });
  });

  it.each([
    [{ detachDuringRead: true }, "setup_required"],
    [{ reauthDuringRead: true }, "reauth_required"],
    [{ replaceDuringRead: true }, "importing"],
    [{ rebuildDuringRead: true }, "importing"],
  ] as const)("withholds a snapshot when its state changes during the read (%o)", async (options, state) => {
    mocks.db.mockReturnValue(wrappedDatabase("ready", options).client);
    expect(await getWrapped(ownerId, runnerId)).toStrictEqual({ state, registration });
  });
});
