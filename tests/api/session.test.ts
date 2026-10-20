import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  catalog: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<object>()),
  requireUser: mocks.user,
}));
vi.mock("@/lib/runnerCatalog", () => ({ getRunnerCatalog: mocks.catalog }));
vi.mock("@/lib/supabaseSession", () => ({
  createSupabaseSession: async () => ({
    auth: { signInWithPassword: mocks.login, signOut: mocks.logout },
  }),
}));
import { GET } from "@/app/api/session/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { AuthenticationError } from "@/lib/auth/session";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
const request = (body: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
describe("session HTTP boundaries", () => {
  it("reports temporary login network failures as retryable service errors", async () => {
    mocks.login.mockResolvedValue({
      error: new AuthRetryableFetchError("private network detail", 0),
    });
    const response = await login(
      request({ email: "a@example.test", password: "test" }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private network detail");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "verified" });
    mocks.catalog.mockResolvedValue({ runners: [], events: [] });
    mocks.login.mockResolvedValue({ error: null });
    mocks.logout.mockResolvedValue({ error: null });
  });
  it("blocks login CSRF before touching authentication", async () => {
    expect(
      (
        await login(
          request({ email: "x", password: "x" }, "https://other.example"),
        )
      ).status,
    ).toBe(403);
    expect(mocks.login).not.toHaveBeenCalled();
  });
  it("blocks logout CSRF", async () => {
    expect((await logout(request({}, "https://other.example"))).status).toBe(
      403,
    );
    expect(mocks.logout).not.toHaveBeenCalled();
  });
  it("validates login input and redacts provider errors", async () => {
    expect((await login(request({ email: 17, password: "x" }))).status).toBe(
      400,
    );
    mocks.login.mockResolvedValue({
      error: { message: "private internal detail" },
    });
    const response = await login(
      request({ email: "a@example.test", password: "test" }),
    );
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("internal");
  });
  it("signs in through the cookie-aware client", async () => {
    const response = await login(
      request({ email: " a@example.test ", password: "test" }),
    );
    expect(response.status).toBe(200);
    expect(mocks.login).toHaveBeenCalledWith({
      email: "a@example.test",
      password: "test",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("uses verified user identity for the catalog", async () => {
    expect((await GET()).status).toBe(200);
    expect(mocks.catalog).toHaveBeenCalledWith("verified");
  });
  it("requires authentication before any catalog read", async () => {
    mocks.user.mockRejectedValue(new AuthenticationError());
    expect((await GET()).status).toBe(401);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
});
