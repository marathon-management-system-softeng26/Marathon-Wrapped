import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), rpc: vi.fn(), from: vi.fn(), invite: vi.fn() }));
vi.mock("@/lib/auth/session", async original => ({ ...await original<object>(), requireUser: mocks.user }));
vi.mock("@/lib/auth/access", async original => ({ ...await original<object>(), requireOrganizerAccess: mocks.access }));
vi.mock("@/lib/supabaseServer", () => ({ getSupabaseAdmin: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/mail/claimInvitation", async original => ({ ...await original<object>(), sendClaimInvitation: mocks.invite }));
import { POST as consume } from "@/app/api/claims/route";
import { POST as create, DELETE as revoke } from "@/app/api/organizer/events/[eventId]/runners/[runnerId]/claim/route";
import { AccessDeniedError } from "@/lib/auth/access";
import { AuthenticationError } from "@/lib/auth/session";
const runnerId = "123e4567-e89b-42d3-a456-426614174000";
const otherRunnerId = "123e4567-e89b-42d3-a456-426614174099";
const organizerParams = { params: Promise.resolve({ eventId: "17", runnerId }) };
const paramsFor = (eventId: string, id: string) => ({ params: Promise.resolve({ eventId, runnerId: id }) });
const req = (url: string, body: unknown, origin = "http://localhost", method = "POST") => new Request(url, { method, headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const deleteClaim = (urlRunnerId = runnerId, claimId = "123e4567-e89b-42d3-a456-426614174002") => revoke(req("http://localhost", { claimId }, "http://localhost", "DELETE"), paramsFor("17", urlRunnerId));
describe("runner claim APIs", () => {
 beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-12T12:00:00.000Z")); vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "verified-user" }); mocks.access.mockResolvedValue(undefined);
  mocks.rpc.mockResolvedValue({ data: "123e4567-e89b-42d3-a456-426614174001", error: null });
  mocks.from.mockImplementation((table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "runners" ? { category_id: 3 } : { event_id: 17 }, error: null }) }) }) }));
  mocks.invite.mockResolvedValue(undefined);
 });
 afterEach(() => vi.useRealTimers());
 it("rejects cross-origin requests before auth or RPC", async () => { expect((await consume(req("http://localhost/api/claims", { token: "x" }, "https://evil.test"))).status).toBe(403); expect(mocks.user).not.toHaveBeenCalled(); });
 it("returns 401 without a verified Supabase session", async () => { mocks.user.mockRejectedValue(new AuthenticationError()); const response = await consume(req("http://localhost/api/claims", { token: "A".repeat(43) })); expect(response.status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled(); });
 it("requires verified identity and never trusts submitted user identifiers", async () => { const response = await consume(req("http://localhost/api/claims", { token: "x", userId: "attacker" })); expect(response.status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
 it("returns 404 for forbidden organizer event scope", async () => { mocks.access.mockRejectedValue(new AccessDeniedError()); const response = await create(req("http://localhost/api", {}), organizerParams); expect(response.status).toBe(404); expect(mocks.rpc).not.toHaveBeenCalled(); });
 it("returns 404 when the URL runner is outside the event", async () => { mocks.from.mockImplementation((table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "runners" ? { category_id: 3 } : { event_id: 18 }, error: null }) }) }) })); const response = await create(req("http://localhost/api", {}), organizerParams); expect(response.status).toBe(404); expect(mocks.rpc).not.toHaveBeenCalled(); });
 it("creates a 256-bit token and stores only its exact digest with a seven-day expiry", async () => { const response = await create(req("http://localhost/api", {}), organizerParams); const payload = await response.json(); expect(response.status).toBe(201); expect(payload.token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(Buffer.from(payload.token, "base64url")).toHaveLength(32); const [fn, args] = mocks.rpc.mock.calls[0]; expect(fn).toBe("create_runner_claim"); expect(args.p_organizer).toBe("verified-user"); expect(args.p_event).toBe(17); expect(args.p_runner).toBe(runnerId); expect(args.p_hash).toBe(createHash("sha256").update(payload.token).digest("hex")); expect(args.p_expires_at).toBe("2026-11-19T12:00:00.000Z"); expect(payload.expiresAt).toBe(args.p_expires_at); expect(response.headers.get("cache-control")).toBe("private, no-store"); });
 it("rejects oversized JSON padding while accepting the same valid token unpadded", async () => { const token = "A".repeat(43); mocks.rpc.mockResolvedValue({ data: "claimed", error: null }); const control = await consume(req("http://localhost/api/claims", { token })); expect(control.status).toBe(200); expect(await control.json()).toEqual({ status: "claimed" }); expect(mocks.rpc).toHaveBeenCalledTimes(1); mocks.rpc.mockClear(); const oversized = await consume(req("http://localhost/api/claims", { token, padding: "x".repeat(1100) })); expect(oversized.status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
 it("consumes a bounded token input and returns idempotent status", async () => { const token = "A".repeat(43); mocks.rpc.mockResolvedValue({ data: "already_claimed_by_you", error: null }); const response = await consume(req("http://localhost/api/claims", { token, userId: "ignored" })); expect(response.status).toBe(200); expect(mocks.rpc.mock.calls[0][1].p_user).toBe("verified-user"); expect(mocks.rpc.mock.calls[0][1].p_hash).toBe(createHash("sha256").update(token).digest("hex")); expect(await response.json()).toEqual({ status: "already_claimed_by_you" }); });
 it("returns the same safe 400 for malformed and RPC-rejected claims without echoing token", async () => { const malformed = await consume(req("http://localhost/api/claims", { token: "x" })); const malformedBody = await malformed.text(); expect(malformed.status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); const token = "A".repeat(43); mocks.rpc.mockResolvedValue({ data: "invalid_claim", error: null }); const rejected = await consume(req("http://localhost/api/claims", { token })); const rejectedBody = await rejected.text(); expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(rejected.status).toBe(malformed.status); expect(rejectedBody).toBe(malformedBody); expect(rejectedBody).not.toContain(token); });
 it("supports organizer revocation with the event and runner URL scope", async () => { mocks.rpc.mockResolvedValue({ data: true, error: null }); const response = await deleteClaim(); expect(response.status).toBe(200); expect(mocks.access).toHaveBeenCalledWith("verified-user", 17); expect(mocks.rpc.mock.calls[0][0]).toBe("revoke_runner_claim"); expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_organizer: "verified-user", p_event: 17, p_runner: runnerId }); });
 it("cannot revoke a different runner claim through another runner URL in the same event", async () => { mocks.rpc.mockImplementation(async (_fn, args) => ({ data: args.p_runner === runnerId, error: null })); const response = await deleteClaim(otherRunnerId); expect(response.status).toBe(404); expect(mocks.rpc.mock.calls[0][1].p_runner).toBe(otherRunnerId); });
 describe("claim code delivery", () => {
  const registered = (runner: Record<string, unknown> = { category_id: 3, name: "Dewi Lestari", email: "dewi@example.com" }) =>
   mocks.from.mockImplementation((table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "runners" ? runner : table === "events" ? { name: "Soekarno Run 2027" } : { event_id: 17 }, error: null }) }) }) }));
  it("mails the code to the registered address and reports it sent", async () => {
   registered();
   const response = await create(req("http://localhost/api", {}), organizerParams);
   const payload = await response.json();
   expect(response.status).toBe(201);
   expect(payload.mailed).toBe(true);
   expect(mocks.invite).toHaveBeenCalledTimes(1);
   expect(mocks.invite.mock.calls[0][0]).toEqual({ to: "dewi@example.com", runnerName: "Dewi Lestari", eventName: "Soekarno Run 2027", token: payload.token, expiresAt: payload.expiresAt });
  });
  it("keeps the token when the relay fails so the claim is not lost", async () => {
   registered();
   mocks.invite.mockRejectedValue(new Error("relay down"));
   const response = await create(req("http://localhost/api", {}), organizerParams);
   const payload = await response.json();
   expect(response.status).toBe(201);
   expect(payload.mailed).toBe(false);
   expect(payload.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
   expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("skips delivery when the registration carries no usable email", async () => {
   registered({ category_id: 3, name: "Dewi Lestari", email: "   " });
   const payload = await (await create(req("http://localhost/api", {}), organizerParams)).json();
   expect(payload.mailed).toBe(false);
   expect(mocks.invite).not.toHaveBeenCalled();
  });
  it("never mails a runner outside the event scope", async () => {
   mocks.from.mockImplementation((table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "runners" ? { category_id: 3, email: "dewi@example.com" } : { event_id: 18 }, error: null }) }) }) }));
   expect((await create(req("http://localhost/api", {}), organizerParams)).status).toBe(404);
   expect(mocks.invite).not.toHaveBeenCalled();
  });
  it("keeps the registered address out of the organizer response", async () => {
   registered();
   const body = await (await create(req("http://localhost/api", {}), organizerParams)).text();
   expect(body).not.toContain("dewi@example.com");
  });
 });
});
