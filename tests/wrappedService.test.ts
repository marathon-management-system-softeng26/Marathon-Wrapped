import { beforeEach, describe, expect, it, vi } from "vitest";
import { ainaInput, citraDnfInput, dewaDnsInput } from "./fixtures/runners";
const mocks = vi.hoisted(() => ({ access: vi.fn(), input: vi.fn(), summary: vi.fn(), enrichment: vi.fn() }));
vi.mock("@/lib/auth/access", () => ({ requireRunnerAccess: mocks.access }));
vi.mock("@/controllers/runnerController", () => ({ getRunnerChipInput: mocks.input, getRunnerSummary: mocks.summary }));
vi.mock("@/controllers/enrichmentController", () => ({ getRunnerEnrichment: mocks.enrichment }));
import { getWrappedForUser } from "@/lib/wrappedService";

describe("authorized computed payload", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.access.mockResolvedValue(undefined);
    mocks.input.mockResolvedValue(ainaInput());
    mocks.summary.mockResolvedValue({ runner_id: ainaInput().runner_id, name: "Aina", bib_number: "A1001" });
    mocks.enrichment.mockResolvedValue({ strava: { state: "disconnected", metrics: null }, photos: [], warnings: [] });
  });
  it("composes the existing hand-calculated split statistics", async () => {
    const payload = await getWrappedForUser("user", ainaInput().runner_id);
    expect(payload?.status).toBe("finisher");
    if (!payload || payload.status === "unavailable") throw new Error("expected stats");
    expect(payload.stats.fastest_km).toEqual({ km_marker: 5, split_seconds: 290 });
    expect(payload.stats.first_half_seconds).toBe(617);
    expect(payload.stats.second_half_seconds).toBe(588);
    expect(payload.stats.insights).toContain("Finish time 25:23");
    expect(payload.strava.metrics).toBeNull();
  });
  it("never queries a result after access denial", async () => {
    mocks.access.mockRejectedValue(new Error("denied"));
    await expect(getWrappedForUser("A", "B")).rejects.toThrow("denied");
    expect(mocks.input).not.toHaveBeenCalled();
  });
  it("distinguishes unavailable results from absent runners", async () => {
    mocks.input.mockResolvedValue(null);
    expect((await getWrappedForUser("A", "B"))?.status).toBe("unavailable");
    mocks.summary.mockResolvedValue(null);
    expect(await getWrappedForUser("A", "B")).toBeNull();
  });
  it.each([[citraDnfInput(), "dnf"], [dewaDnsInput(), "dns"]] as const)("preserves non-finisher null fields", async (input, status) => {
    mocks.input.mockResolvedValue(input);
    const result = await getWrappedForUser("user", input.runner_id);
    expect(result?.status).toBe(status);
    if (result && result.status !== "unavailable") {
      expect(result.stats.elapsed_seconds).toBeNull();
      expect(result.stats.avg_pace_sec_km).toBeNull();
    }
  });
  it("keeps baseline after optional-source failure", async () => {
    mocks.enrichment.mockRejectedValue(new Error("provider secret"));
    const result = await getWrappedForUser("user", ainaInput().runner_id);
    expect(result?.status).toBe("finisher");
    expect(JSON.stringify(result)).not.toContain("provider secret");
    if (result && result.status !== "unavailable") expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("aborts a stalled optional query and returns the baseline within its deadline", async () => {
    vi.useFakeTimers();
    try {
      mocks.enrichment.mockReturnValue(new Promise(() => {}));
      const pending = getWrappedForUser("user", ainaInput().runner_id);
      await vi.advanceTimersByTimeAsync(1300);
      const signal = mocks.enrichment.mock.calls[0][2] as AbortSignal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(true);
      const result = await pending;
      expect(result?.status).toBe("finisher");
      if (result && result.status !== "unavailable") expect(result.warnings.length).toBeGreaterThan(0);
    } finally { vi.useRealTimers(); }
  });
});
