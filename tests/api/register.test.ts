import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signUp: vi.fn() }));

vi.mock("@/lib/supabaseSession", () => ({
  createSupabaseSession: async () => ({
    auth: { signUp: mocks.signUp },
  }),
}));

import { POST as register } from "@/app/api/auth/register/route";

const request = (body: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("registration HTTP boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signUp.mockResolvedValue({
      data: { user: { id: "new-user" }, session: null },
      error: null,
    });
  });

  it("creates an account with normalized credentials", async () => {
    const response = await register(
      request({ email: " new@example.test ", password: "password-123" }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      requiresEmailConfirmation: true,
    });
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: "new@example.test",
      password: "password-123",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("blocks cross-origin registration before authentication", async () => {
    const response = await register(
      request(
        { email: "new@example.test", password: "password-123" },
        "https://other.example",
      ),
    );

    expect(response.status).toBe(403);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("rejects malformed registration input", async () => {
    const response = await register(
      request({ email: "new@example.test", password: "short" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("returns an authenticated success when signup creates a session", async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: { id: "new-user" }, session: { access_token: "token" } },
      error: null,
    });

    const response = await register(
      request({ email: "new@example.test", password: "password-123" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      requiresEmailConfirmation: false,
    });
  });

  it("redacts authentication provider errors", async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "private provider detail", status: 400 },
    });

    const response = await register(
      request({ email: "new@example.test", password: "password-123" }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private provider detail");
  });
});
