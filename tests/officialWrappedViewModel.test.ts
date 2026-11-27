import { describe, expect, it } from "vitest";
import { toWrappedCheckpointRows } from "@/lib/wrappedCheckpoints";

describe("official Wrapped checkpoint rows", () => {
  it("preserves every published checkpoint in source sequence and label", () => {
    expect(toWrappedCheckpointRows([
      {
        sequence: 1,
        label: "Checkpoint 1 - KM 3.7",
        distanceMeters: 3700,
        displayedTimeMs: 1_200_000,
        reportedSplitMs: 1_200_000,
        referenceLabel: null,
      },
      {
        sequence: 2,
        label: "Checkpoint 2 - KM 8.3",
        distanceMeters: 8300,
        displayedTimeMs: 2_500_000,
        reportedSplitMs: 1_300_000,
        referenceLabel: null,
      },
      {
        sequence: 3,
        label: "Finish",
        distanceMeters: 10_000,
        displayedTimeMs: 3_100_000,
        reportedSplitMs: 600_000,
        referenceLabel: "Finish",
      },
    ])).toEqual([
      {
        sequence: 1,
        label: "Checkpoint 1 - KM 3.7",
        distanceMeters: 3700,
        displayedTimeMs: 1_200_000,
        reportedSplitMs: 1_200_000,
        referenceLabel: null,
      },
      {
        sequence: 2,
        label: "Checkpoint 2 - KM 8.3",
        distanceMeters: 8300,
        displayedTimeMs: 2_500_000,
        reportedSplitMs: 1_300_000,
        referenceLabel: null,
      },
      {
        sequence: 3,
        label: "Finish",
        distanceMeters: 10_000,
        displayedTimeMs: 3_100_000,
        reportedSplitMs: 600_000,
        referenceLabel: "Finish",
      },
    ]);
  });

  it("does not turn missing timing values into zeroes", () => {
    expect(toWrappedCheckpointRows([{
      sequence: 1,
      label: "Checkpoint 1",
      distanceMeters: null,
      displayedTimeMs: null,
      reportedSplitMs: null,
      referenceLabel: null,
    }])).toEqual([{
      sequence: 1,
      label: "Checkpoint 1",
      distanceMeters: null,
      displayedTimeMs: null,
      reportedSplitMs: null,
      referenceLabel: null,
    }]);
  });
});
