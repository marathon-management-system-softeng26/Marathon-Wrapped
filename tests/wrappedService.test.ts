import { beforeEach, describe, expect, it, vi } from "vitest";
import { ainaInput, citraDnfInput, dewaDnsInput } from "./fixtures/runners";
const mocks = vi.hoisted(() => ({ access: vi.fn(), input: vi.fn(), summary: vi.fn(), enrichment: vi.fn() }));
vi.mock("@/lib/auth/access", () => ({ requireRunnerAccess: mocks.access }));
vi.mock("@/controllers/runnerController", () => ({ getRunnerChipInput: mocks.input, getRunnerSummary: mocks.summary }));
vi.mock("@/controllers/enrichmentController", () => ({ getRunnerEnrichment: mocks.enrichment }));
import { getWrappedForUser } from "@/lib/wrappedService";
import { shareModel } from "@/lib/shareModel";

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
  it("scopes optional live data to the authenticated user and keeps chip/export values unchanged", async () => {
    mocks.enrichment.mockResolvedValue({ strava: { state: "connected", metrics: { avg_heartrate: 145.5, avg_cadence: 80.5 } }, photos: [], warnings: [] });
    const result = await getWrappedForUser("owner", ainaInput().runner_id);
    expect(mocks.enrichment).toHaveBeenCalledWith(ainaInput().runner_id, "A1001", expect.any(AbortSignal), "owner");
    if (!result || result.status === "unavailable") throw new Error("expected recap");
    expect(result.stats.elapsed_seconds).toBe(1523);
    expect(shareModel(result)).toMatchObject({ time: "25:23", pace: "5:05 /km", rank: "Category rank 1" });
    expect(JSON.stringify(shareModel(result))).not.toMatch(/heartrate|cadence|145.5|80.5/);
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
  it("keeps the chip recap usable when Strava enrichment is unavailable", async () => {
    mocks.enrichment.mockRejectedValue(new Error("Strava unavailable"));

    const result = await getWrappedForUser("user", ainaInput().runner_id);

    expect(result?.status).toBe("finisher");
    if (!result || result.status === "unavailable") throw new Error("expected chip recap");
    expect(result.stats).toMatchObject({
      runner_id: "11111111-1111-1111-1111-111111111111",
      elapsed_seconds: 1523,
      avg_pace_sec_km: 304.6,
      category_rank: 1,
      fastest_km: { km_marker: 5, split_seconds: 290 },
      first_half_seconds: 617,
      second_half_seconds: 588,
    });
    expect(result.strava).toEqual({ state: "unavailable", metrics: null });
    expect(result.warnings).toEqual([expect.any(String)]);
    expect(result.warnings[0].length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("Strava unavailable");
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
  it("preserves completed photos when the live lookup settles just after the deadline abort", async () => {
    vi.useFakeTimers();
    try {
      mocks.enrichment.mockImplementation((_runnerId, _bib, signal: AbortSignal) => new Promise((resolve) => {
        signal.addEventListener("abort", () => setTimeout(() => resolve({
          strava: { state: "unavailable", metrics: null },
          photos: [{ id: "photo", bib_number: "A1001", photo_url: "/photos/finish.jpg", photographer: null, captured_km: null, captured_at: null }],
          warnings: ["Extra activity details are unavailable. Your chip recap is ready."],
        }), 1), { once: true });
      }));
      const pending = getWrappedForUser("user", ainaInput().runner_id);
      await vi.advanceTimersByTimeAsync(1202);
      const result = await pending;
      if (!result || result.status === "unavailable") throw new Error("expected recap");
      expect(result.strava).toEqual({ state: "unavailable", metrics: null });
      expect(result.photos).toEqual([expect.objectContaining({ id: "photo", photo_url: "/photos/finish.jpg" })]);
    } finally { vi.useRealTimers(); }
  });
});
