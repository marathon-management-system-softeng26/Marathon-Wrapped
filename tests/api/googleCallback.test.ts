import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ exchange: vi.fn() }));

vi.mock("@/lib/supabaseSession", () => ({
  createSupabaseSession: async () => ({ auth: { exchangeCodeForSession: mocks.exchange } }),
}));

import { GET } from "@/app/auth/callback/route";

describe("Google auth callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exchange.mockResolvedValue({ error: null });
  });

  it("exchanges the OAuth code and redirects to the app", async () => {
    const response = await GET(new Request("https://app.example/auth/callback?code=oauth-code"));

    expect(mocks.exchange).toHaveBeenCalledWith("oauth-code");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://app.example/");
  });

  it("rejects missing or failed OAuth codes without exposing provider details", async () => {
    const missing = await GET(new Request("https://app.example/auth/callback"));
    expect(missing.headers.get("location")).toBe("https://app.example/login?error=oauth_callback_failed");
    expect(mocks.exchange).not.toHaveBeenCalled();

    mocks.exchange.mockResolvedValue({ error: { message: "private provider detail" } });
    const failed = await GET(new Request("https://app.example/auth/callback?code=bad"));
    expect(failed.headers.get("location")).toBe("https://app.example/login?error=oauth_callback_failed");
  });

  it("accepts only local next paths", async () => {
    const response = await GET(new Request("https://app.example/auth/callback?code=oauth-code&next=%2Frecap"));
    expect(response.headers.get("location")).toBe("https://app.example/recap");

    const unsafe = await GET(new Request("https://app.example/auth/callback?code=oauth-code&next=https%3A%2F%2Fevil.example"));
    expect(unsafe.headers.get("location")).toBe("https://app.example/");
  });
});
