import { describe, expect, it } from "vitest";
import { shareModel } from "@/lib/shareModel";
import type { WrappedPayload } from "@/lib/wrappedPayload";
const payload = (status: "finisher" | "dnf" | "dns") =>
  ({
    status,
    stats: {
      name: "Aina",
      bib_number: "A-1",
      event: "Race",
      distance_km: 5,
      elapsed_seconds: 1523,
      avg_pace_sec_km: 304.6,
      category_rank: 1,
    },
    photos: [],
    warnings: [],
    strava: { state: "disconnected", metrics: null },
  }) as unknown as WrappedPayload;
describe("share composition", () => {
  it("formats the selected finisher's actual time, pace and distance", () => {
    expect(shareModel(payload("finisher"))).toMatchObject({
      name: "Aina",
      distance: "5.0 km",
      time: "25:23",
      pace: "5:05 /km",
      result: "Finished",
      rank: "Category rank 1",
    });
  });
  it.each(["dnf", "dns"] as const)(
    "never exports fabricated finish data for %s",
    (status) => {
      const model = shareModel(payload(status));
      expect(model.distanceLabel).toBe("Category distance");
      expect(model.time).toBe("—");
      expect(model.pace).toBe("—");
      expect(model.rank).toBe("");
      expect(model.result).toBe(
        status === "dnf" ? "Did not finish" : "Did not start",
      );
    },
  );
  it("preserves missing-result truth", () => {
    expect(
      shareModel({
        status: "unavailable",
        runner: { runner_id: "x", name: "Adi", bib_number: null },
        reason: "missing_result",
      }),
    ).toMatchObject({
      name: "Adi",
      distance: "—",
      time: "—",
      result: "Result unavailable",
    });
  });
});
