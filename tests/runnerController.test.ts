import { beforeEach, describe, expect, it, vi } from "vitest";
import { ainaInput } from "./fixtures/runners";
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabaseServer", () => ({ getSupabaseAdmin: () => ({ from }) }));
import { getRunnerChipInput, getRunnerSummary } from "@/controllers/runnerController";

function query(data: unknown, error: unknown = null) {
  return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: async () => ({ data, error }), order: async () => ({ data, error }) };
}
describe("validated runner repository", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns absent result without relabeling it DNF", async () => {
    from.mockReturnValue(query(null));
    expect(await getRunnerChipInput(ainaInput().runner_id)).toBeNull();
  });
  it("returns a summary independently of the result view", async () => {
    from.mockReturnValue(query({ id: ainaInput().runner_id, name: "Aina", bib_number: "A1001", email: "secret" }));
    expect(await getRunnerSummary(ainaInput().runner_id)).toEqual({ runner_id: ainaInput().runner_id, name: "Aina", bib_number: "A1001" });
    expect(from).toHaveBeenCalledWith("runners");
  });
  it("whitelists and validates numeric chip fields and timestamps", async () => {
    const input = ainaInput();
    from.mockImplementation((table: string) => query(table === "runner_wrapped" ? { ...input, distance_km: "5", email: "secret" } : table === "chip_results" ? { start_time: "2027-08-17T06:00:00Z", finish_time: "2027-08-17T06:25:23Z" } : input.splits));
    expect(await getRunnerChipInput(input.runner_id)).toEqual(input);
  });
  it("throws on missing raw timing or required split query error", async () => {
    from.mockImplementation((table: string) => query(table === "runner_wrapped" ? ainaInput() : null));
    await expect(getRunnerChipInput(ainaInput().runner_id)).rejects.toThrow();
    from.mockImplementation((table: string) => table === "chip_splits" ? query(null, { message: "down" }) : query(ainaInput()));
    await expect(getRunnerChipInput(ainaInput().runner_id)).rejects.toThrow();
  });
});
