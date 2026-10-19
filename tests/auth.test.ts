import { beforeEach, describe, expect, it, vi } from "vitest";
const { from, getUser } = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabaseServer", () => ({ getSupabaseAdmin: () => ({ from }) }));
vi.mock("@/lib/supabaseSession", () => ({ createSupabaseSession: async () => ({ auth: { getUser } }) }));
import { requireUser, AuthenticationError } from "@/lib/auth/session";
import { requireRunnerAccess, requireOrganizerAccess, AccessDeniedError } from "@/lib/auth/access";

function query(data: unknown) {
  return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: async () => ({ data, error: null }) };
}
describe("verified identity and event access", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects absent and expired sessions before any privileged query", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "Expired" } });
    await expect(requireUser()).rejects.toThrow(AuthenticationError);
    expect(from).not.toHaveBeenCalled();
  });
  it("uses verified identity, never user metadata roles", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "A", user_metadata: { role: "organizer" } } }, error: null });
    expect(await requireUser()).toEqual({ id: "A" });
    from.mockReturnValue(query(null));
    await expect(requireRunnerAccess("A", "B")).rejects.toThrow(AccessDeniedError);
  });
  it("allows an explicit runner mapping", async () => {
    const q = query({ runner_id: "A" }); from.mockReturnValue(q);
    await expect(requireRunnerAccess("user-A", "A")).resolves.toBeUndefined();
    expect(q.eq).toHaveBeenCalledWith("user_id", "user-A");
    expect(q.eq).toHaveBeenCalledWith("runner_id", "A");
  });
  it("checks organizer event scope", async () => {
    from.mockReturnValue(query(null));
    await expect(requireOrganizerAccess("organizer", 2)).rejects.toThrow(AccessDeniedError);
    from.mockReturnValue(query({ event_id: 1 }));
    await expect(requireOrganizerAccess("organizer", 1)).resolves.toBeUndefined();
  });
  it("fails closed on access database errors", async () => {
    from.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: async () => ({ data: null, error: { message: "down" } }) });
    await expect(requireRunnerAccess("A", "B")).rejects.toThrow();
  });
});
