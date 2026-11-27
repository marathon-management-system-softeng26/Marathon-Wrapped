import { beforeEach, describe, expect, it, vi } from "vitest";
import { candidate, personalPhoto, photo, ready, registration, runnerId } from "../fixtures/stravaWrapped";
import { ainaInput } from "../fixtures/runners";
import { buildWrappedStats } from "@/lib/stats";
import { organizerId, ownerId, publishedOfficialDatabase, wrappedDatabase, type TestState } from "../fixtures/stravaWrappedDatabase";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), db: vi.fn(), chip: vi.fn(), runnerSummary: vi.fn(), wrapped: vi.fn(), photoBucket: vi.fn(),
}));
vi.mock("@/lib/auth/session", async (original) => ({ ...await original<object>(), requireUser: mocks.user }));
vi.mock("@/lib/supabaseServer", () => ({ getSupabaseAdmin: mocks.db }));
vi.mock("@/controllers/runnerController", () => ({ getRunnerChipInput: mocks.chip, getRunnerSummary: mocks.runnerSummary }));
vi.mock("@/lib/wrappedService", () => ({ getWrappedForUser: mocks.wrapped }));
vi.mock("@/lib/runnerPhotos/storage", () => ({ privatePhotoBucket: mocks.photoBucket }));

import { GET } from "@/app/api/runners/[runnerId]/wrapped/route";
import { AuthenticationError } from "@/lib/auth/session";

const call = (id = runnerId) => GET(new Request(`http://localhost/api/runners/${id}/wrapped`), { params: Promise.resolve({ runnerId: id }) });

describe("private Wrapped HTTP boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.user.mockResolvedValue({ id: ownerId });
    mocks.wrapped.mockResolvedValue(null);
  });

  it.each<TestState>(["setup_required", "authorizing", "importing", "needs_confirmation", "no_match", "building", "ready", "failed", "reauth_required"])(
    "returns only the permitted %s data and disables caching",
    async (state) => {
      mocks.db.mockReturnValue(wrappedDatabase(state).client);
      const response = await call();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = await response.json();
      const expected = state === "ready" ? ready : state === "needs_confirmation" ? { state, registration, candidates: [candidate] } : { state, registration };
      expect(body).toStrictEqual(expected);
      expect(mocks.photoBucket).toHaveBeenCalledTimes(state === "ready" ? 1 : 0);
      expect(mocks.wrapped).toHaveBeenCalledWith(ownerId, runnerId);
      expect(mocks.chip).not.toHaveBeenCalled();
      expect(mocks.runnerSummary).not.toHaveBeenCalled();
    },
  );

  it.each(["official", "legacy", "Strava"])("merges only this owner's selected ready photos once after %s resolution", async (path) => {
    const db = path === "official" ? publishedOfficialDatabase() : wrappedDatabase("ready");
    mocks.db.mockReturnValue(db.client);
    if (path === "legacy") {
      mocks.wrapped.mockResolvedValue({ status: "finisher", stats: buildWrappedStats(ainaInput()),
        strava: { state: "disconnected", metrics: null }, photos: [photo], warnings: [] });
    }
    const first = { id: personalPhoto.id, user_id: ownerId, runner_id: runnerId, included: true,
      state: "ready", created_at: "2026-11-01T08:00:00Z" };
    const second = { ...first, id: "60000000-0000-4000-a000-000000000002", created_at: "2026-11-02T08:00:00Z" };
    db.tables.runner_uploaded_photos = [second, first, { ...first, id: "deselected", included: false },
      { ...first, id: "pending", state: "pending" }, { ...first, id: "finalizing", state: "finalizing" },
      { ...first, id: "other-owner", user_id: organizerId }, { ...first, id: "other-runner", runner_id: organizerId }];

    const response = await call();
    expect(response.status).toBe(200);
    const body = await response.json();
    const organizerPhoto = path === "official" ? { ...photo, bib_number: null, photographer: null } : photo;
    expect(body.photos).toStrictEqual([personalPhoto,
      { ...personalPhoto, id: second.id, photo_url: `/api/runners/${runnerId}/photos/${second.id}/content` }, organizerPhoto]);
    if (path === "Strava") expect(body.snapshot).toEqual(ready.snapshot);
    else {
      expect(body).toMatchObject({ kind: "official", result: { eventId: path === "official" ? 17 : 0 } });
      expect(body.strava).toStrictEqual({ ...ready, photos: [organizerPhoto] });
    }
    const queries = db.requests.filter(url => url.pathname.endsWith("/runner_uploaded_photos"));
    expect(queries).toHaveLength(1);
    expect(db.requests.at(-1)).toBe(queries[0]);
  });

  it("returns the original ready recap and organizer photo on personal lookup failure", async () => {
    mocks.db.mockReturnValue(wrappedDatabase("ready").client);
    mocks.photoBucket.mockRejectedValue(new Error("internal storage detail"));
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ ...ready, photoWarning: "Selected photos could not load. Retry your Wrapped to try again." });
    expect(mocks.photoBucket).toHaveBeenCalledOnce();
  });

  it("keeps the recap available when the personal lookup stalls", async () => {
    vi.useFakeTimers();
    try {
      mocks.db.mockReturnValue(wrappedDatabase("ready").client);
      const lookupStarted = new Promise<void>(resolve => {
        mocks.photoBucket.mockImplementation(() => {
          resolve();
          return new Promise(() => {});
        });
      });
      const response = call();
      await lookupStarted;
      await vi.advanceTimersByTimeAsync(1200);
      expect(await (await response).json()).toStrictEqual({ ...ready, photoWarning: "Selected photos could not load. Retry your Wrapped to try again." });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects organizer-only access with the same private 404 as a missing runner", async () => {
    const db = wrappedDatabase();
    mocks.db.mockReturnValue(db.client);
    const missing = await call("22222222-2222-2222-2222-222222222222");
    mocks.user.mockResolvedValue({ id: organizerId });
    const forbidden = await call();
    expect([missing.status, forbidden.status]).toEqual([404, 404]);
    expect(await forbidden.json()).toStrictEqual(await missing.json());
    expect(mocks.photoBucket).not.toHaveBeenCalled();
    expect(forbidden.headers.get("cache-control")).toBe("private, no-store");
    expect(db.requests.map((url) => url.pathname)).toEqual(["/rest/v1/runner_access", "/rest/v1/runner_access"]);
  });

  it("rejects malformed IDs before authentication or database queries", async () => {
    const response = await call("invalid");
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it("does not read storage without a verified session", async () => {
    mocks.user.mockRejectedValue(new AuthenticationError());
    const response = await call();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it("returns a private generic error when storage is unavailable", async () => {
    mocks.db.mockImplementation(() => { throw new Error("secret infrastructure detail"); });
    const response = await call();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("secret infrastructure");
  });
});
