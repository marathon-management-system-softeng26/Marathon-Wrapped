import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), save: vi.fn(), results: vi.fn() }));
vi.mock("@/lib/auth/session", async original => ({ ...await original<object>(), requireUser: mocks.user }));
vi.mock("@/controllers/organizerController", async original => ({ ...await original<object>(), saveHeroRunner: mocks.save, getEventResults: mocks.results }));
import { POST } from "@/app/api/organizer/events/[eventId]/runners/route";
import { GET } from "@/app/api/organizer/events/[eventId]/results/route";
import { AccessDeniedError } from "@/lib/auth/access";
const params = { params: Promise.resolve({ eventId: "1" }) };
const request = (origin = "http://localhost") => new Request("http://localhost/api/organizer/events/1/runners", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Demo" }) });
describe("organizer HTTP boundaries", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "organizer" }); mocks.save.mockResolvedValue({ runner_id: "saved" }); mocks.results.mockResolvedValue([{ status: "unavailable" }]); });
  it("rejects cross-origin cookie-authenticated writes before queries", async () => {
    expect((await POST(request("https://attacker.example"), params)).status).toBe(403);
    expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("validates the event identifier before queries", async () => {
    expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ eventId: "invalid" }) })).status).toBe(400);
    expect(mocks.results).not.toHaveBeenCalled();
  });
  it("uses verified identity and the URL event for a create", async () => {
    const response = await POST(request(), params); expect(response.status).toBe(201);
    expect(mocks.save).toHaveBeenCalledWith("organizer", 1, null, { name: "Demo" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("compares the browser origin with the actual Host, not Next's internal hostname", async () => {
    const incoming = new Request("http://localhost:3007/api/organizer/events/1/runners", {
      method: "POST", headers: { Host: "127.0.0.1:3007", Origin: "http://127.0.0.1:3007", "Content-Type": "application/json" }, body: "{}",
    });
    expect((await POST(incoming, params)).status).toBe(201);
  });
  it("reports event access denial without returning event rows", async () => {
    mocks.results.mockRejectedValue(new AccessDeniedError());
    const response = await GET(new Request("http://localhost"), params);
    expect(response.status).toBe(403); expect(await response.json()).not.toHaveProperty("results");
  });
  it("preserves the unavailable lifecycle in organizer results", async () => {
    const response = await GET(new Request("http://localhost"), params);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ results: [{ status: "unavailable" }] });
  });
});
