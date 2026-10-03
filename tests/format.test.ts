import { describe, expect, it } from "vitest";
import { formatMmSs } from "@/lib/format";

describe("formatMmSs", () => {
  it("formats minutes and zero-padded seconds without hours", () => {
    expect(formatMmSs(270)).toBe("4:30");
  });
});
