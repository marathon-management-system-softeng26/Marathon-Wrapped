import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/auth/access", () => ({ requireOrganizerAccess: mocks.guard }));
vi.mock("@/lib/supabaseServer", () => ({ getSupabaseAdmin: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
import { validateHeroDraft, HeroValidationError } from "@/lib/heroValidation";
import { saveHeroRunner } from "@/controllers/organizerController";
const draft = () => ({ name: "Demo Hero", bib_number: "DEMO-001", date_of_birth: "1995-04-12", gender: "F", parental_consent: false, category: "5K", result: { finisher: true, start_status: "on-time", start_time: "2027-08-17T06:00:00+07:00", finish_time: "2027-08-17T06:25:00+07:00" }, splits: Array.from({ length: 5 }, (_, i) => ({ km_marker: i+1, split_seconds: 300 })) });
describe("hero aggregate validation and event authorization", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue(undefined); mocks.rpc.mockResolvedValue({ data: "11111111-1111-1111-1111-111111111111", error: null }); });
  it("accepts a complete finisher without trusting supplied derived statistics", () => {
    const validated = validateHeroDraft({ ...draft(), elapsed_seconds: 1, email: "private@example.test" });
    expect(validated.name).toBe("Demo Hero"); expect(validated).not.toHaveProperty("elapsed_seconds"); expect(validated).not.toHaveProperty("email");
  });
  it.each([
    { date_of_birth: "2026-02-31" }, { name: "" }, { category: "21K" },
    { splits: [{ km_marker: 1, split_seconds: 300 }] },
    { splits: Array.from({ length: 5 }, () => ({ km_marker: 1, split_seconds: 300 })) },
  ])("rejects malformed or incomplete demo finishers", fields => {
    expect(() => validateHeroDraft({ ...draft(), ...fields })).toThrow(HeroValidationError);
  });
  it("supports an explicit result-unavailable record", () => {
    expect(validateHeroDraft({ ...draft(), result: null, splits: [] }).result).toBeNull();
  });
  it("distinguishes DNS and observed-start DNF", () => {
    expect(validateHeroDraft({ ...draft(), result: { finisher: false, start_status: "dns", start_time: null, finish_time: null }, splits: [] }).result?.start_status).toBe("dns");
    expect(() => validateHeroDraft({ ...draft(), result: { finisher: false, start_status: "on-time", start_time: null, finish_time: null }, splits: [] })).toThrow(HeroValidationError);
  });
  it("denies wrong-event writers before an RPC call", async () => {
    mocks.guard.mockRejectedValue(new Error("Wrong event"));
    await expect(saveHeroRunner("user", 2, null, draft())).rejects.toThrow("Wrong event");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses the authorized URL event and runner parameters in one aggregate RPC", async () => {
    expect(await saveHeroRunner("user", 1, null, draft())).toEqual({ runner_id: "11111111-1111-1111-1111-111111111111" });
    expect(mocks.rpc).toHaveBeenCalledWith("save_hero_runner", { p_event_id: 1, p_runner_id: null, p_draft: validateHeroDraft(draft()) });
  });
});
