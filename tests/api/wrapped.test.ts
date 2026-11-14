import { beforeEach, describe, expect, it, vi } from "vitest";
import { candidate, ready, registration, runnerId } from "../fixtures/stravaWrapped";
import { organizerId, ownerId, wrappedDatabase, type TestState } from "../fixtures/stravaWrappedDatabase";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), db: vi.fn(), chip: vi.fn(), runnerSummary: vi.fn(), wrapped: vi.fn(),
}));
vi.mock("@/lib/auth/session", async (original) => ({ ...await original<object>(), requireUser: mocks.user }));
vi.mock("@/lib/supabaseServer", () => ({ getSupabaseAdmin: mocks.db }));
vi.mock("@/controllers/runnerController", () => ({ getRunnerChipInput: mocks.chip, getRunnerSummary: mocks.runnerSummary }));
vi.mock("@/lib/wrappedService", () => ({ getWrappedForUser: mocks.wrapped }));

import { GET } from "@/app/api/runners/[runnerId]/wrapped/route";
import { AuthenticationError } from "@/lib/auth/session";

const call = (id = runnerId) => GET(new Request(`http://localhost/api/runners/${id}/wrapped`), { params: Promise.resolve({ runnerId: id }) });

describe("private Wrapped HTTP boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.user.mockResolvedValue({ id: ownerId });
    mocks.wrapped.mockResolvedValue({ status: "finisher", stats: { elapsed_seconds: 1523 } });
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
      expect(mocks.wrapped).not.toHaveBeenCalled();
      expect(mocks.chip).not.toHaveBeenCalled();
      expect(mocks.runnerSummary).not.toHaveBeenCalled();
    },
  );

  it("rejects organizer-only access with the same private 404 as a missing runner", async () => {
    const db = wrappedDatabase();
    mocks.db.mockReturnValue(db.client);
    const missing = await call("22222222-2222-2222-2222-222222222222");
    mocks.user.mockResolvedValue({ id: organizerId });
    const forbidden = await call();
    expect([missing.status, forbidden.status]).toEqual([404, 404]);
    expect(await forbidden.json()).toStrictEqual(await missing.json());
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
