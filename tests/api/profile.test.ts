import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  readName: vi.fn(),
  saveName: vi.fn(),
  linkBib: vi.fn(),
}));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<object>()),
  requireUser: mocks.user,
}));
vi.mock("@/controllers/profileController", async (original) => ({
  ...(await original<object>()),
  getProfileName: mocks.readName,
  saveProfileName: mocks.saveName,
  linkRegistrationByBib: mocks.linkBib,
}));
import { GET, PUT } from "@/app/api/profile/route";
import { POST } from "@/app/api/registrations/bib/route";
import { AuthenticationError } from "@/lib/auth/session";
import { ProfileError, unavailableBibMessage } from "@/controllers/profileController";

const write = (
  path: string,
  method: string,
  body: unknown,
  origin = "http://localhost",
) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("profile HTTP boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "runner", email: "runner@example.invalid" });
    mocks.readName.mockResolvedValue("Dewi Kartika");
    mocks.saveName.mockResolvedValue("Dewi Kartika");
    mocks.linkBib.mockResolvedValue("linked");
  });

  it("returns the stored name with the verified session email", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      display_name: "Dewi Kartika",
      email: "runner@example.invalid",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("asks an unauthenticated reader to sign in instead of answering", async () => {
    mocks.user.mockRejectedValue(new AuthenticationError());
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty("email");
  });

  it("rejects cross-origin cookie-authenticated writes before any query", async () => {
    const name = await PUT(write("/api/profile", "PUT", { display_name: "x" }, "https://attacker.example"));
    expect(name.status).toBe(403);
    const bib = await POST(write("/api/registrations/bib", "POST", { bib_number: "A1205" }, "https://attacker.example"));
    expect(bib.status).toBe(403);
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.saveName).not.toHaveBeenCalled();
    expect(mocks.linkBib).not.toHaveBeenCalled();
  });

  it("saves the name under the verified account id, never a body field", async () => {
    const response = await PUT(write("/api/profile", "PUT", { display_name: "Dewi Kartika", user_id: "someone-else" }));
    expect(response.status).toBe(200);
    expect(mocks.saveName).toHaveBeenCalledWith("runner", "Dewi Kartika");
  });

  it("refuses a body that is not a JSON object", async () => {
    for (const body of ["not json", JSON.stringify(["Dewi"]), JSON.stringify("Dewi")]) {
      const response = await PUT(write("/api/profile", "PUT", body));
      expect(response.status).toBe(400);
    }
    expect(mocks.saveName).not.toHaveBeenCalled();
  });

  it("refuses an oversized body rather than buffering it", async () => {
    const response = await PUT(write("/api/profile", "PUT", { display_name: "n".repeat(4096) }));
    expect(response.status).toBe(400);
    expect(mocks.saveName).not.toHaveBeenCalled();
  });

  it("passes a validation failure through with the controller's own status", async () => {
    mocks.saveName.mockRejectedValue(new ProfileError("Enter a display name.", 400));
    const response = await PUT(write("/api/profile", "PUT", { display_name: " " }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Enter a display name." });
  });

  it("reports an unexpected save failure as unavailable, not as a bad request", async () => {
    mocks.saveName.mockRejectedValue(new Error("connection reset"));
    const response = await PUT(write("/api/profile", "PUT", { display_name: "Dewi" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Your profile could not be saved. Please retry." });
  });

  it("links a BIB under the verified account id", async () => {
    const response = await POST(write("/api/registrations/bib", "POST", { bib_number: "A1205" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "linked" });
    expect(mocks.linkBib).toHaveBeenCalledWith("runner", "A1205");
  });

  it("answers a refused BIB with one message that reveals nothing", async () => {
    mocks.linkBib.mockRejectedValue(new ProfileError(unavailableBibMessage, 400));
    const response = await POST(write("/api/registrations/bib", "POST", { bib_number: "A1206" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: unavailableBibMessage });
  });

  it("answers a throttled account with 429 so the page can say to wait", async () => {
    mocks.linkBib.mockRejectedValue(new ProfileError("Too many tries.", 429));
    const response = await POST(write("/api/registrations/bib", "POST", { bib_number: "A1207" }));
    expect(response.status).toBe(429);
  });

  it("asks an unauthenticated writer to sign in before touching ownership", async () => {
    mocks.user.mockRejectedValue(new AuthenticationError());
    const response = await POST(write("/api/registrations/bib", "POST", { bib_number: "A1205" }));
    expect(response.status).toBe(401);
    expect(mocks.linkBib).not.toHaveBeenCalled();
  });
});
