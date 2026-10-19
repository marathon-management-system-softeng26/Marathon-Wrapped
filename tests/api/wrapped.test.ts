import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), wrapped: vi.fn() }));
vi.mock("@/lib/auth/session", async (original) => ({ ...await original<object>(), requireUser: mocks.user }));
vi.mock("@/lib/wrappedService", () => ({ getWrappedForUser: mocks.wrapped }));
import { GET } from "@/app/api/runners/[runnerId]/wrapped/route";
import { AuthenticationError } from "@/lib/auth/session";
import { AccessDeniedError } from "@/lib/auth/access";
import { InvalidRunnerDataError } from "@/lib/runnerValidation";
const runnerId = "11111111-1111-1111-1111-111111111111";
const call = (id = runnerId) => GET(new Request(`http://localhost/api/runners/${id}/wrapped`), { params: Promise.resolve({ runnerId: id }) });
describe("protected wrapped HTTP boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "user-A" }); mocks.wrapped.mockResolvedValue({ status: "finisher" }); });
  it("rejects malformed IDs before authentication or database queries", async () => {
    expect((await call("invalid")).status).toBe(400);
    expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.wrapped).not.toHaveBeenCalled();
  });
  it("does not query results without a verified session", async () => {
    mocks.user.mockRejectedValue(new AuthenticationError());
    const response = await call(); expect(response.status).toBe(401);
    expect(mocks.wrapped).not.toHaveBeenCalled();
  });
  it("returns JSON with no-store on success", async () => {
    const response = await call(); expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.wrapped).toHaveBeenCalledWith("user-A", runnerId);
  });
  it("uses identical 404 bodies for unknown and forbidden runners", async () => {
    mocks.wrapped.mockResolvedValue(null); const absent = await call();
    mocks.wrapped.mockRejectedValue(new AccessDeniedError()); const denied = await call();
    expect(absent.status).toBe(404); expect(denied.status).toBe(404);
    expect(await absent.json()).toEqual(await denied.json());
  });
  it.each([[new InvalidRunnerDataError(), 422], [new Error("secret infrastructure detail"), 503]] as const)("maps errors without leaking internals", async (error, status) => {
    mocks.wrapped.mockRejectedValue(error); const response = await call();
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("secret infrastructure");
  });
});
