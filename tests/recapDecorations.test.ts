import { describe, expect, it } from "vitest";
import { recapDecorations } from "@/lib/recapDecorations";

describe("recap decoration slots", () => {
  it("keeps every recap scene on local, meaningful artwork", () => {
    expect(recapDecorations).toEqual({
      intro: ["shoe.svg", "running.svg"],
      finisher: ["finisher-card.svg"],
      distance: ["medal.svg", "music.svg"],
      splits: ["watch-pace.svg"],
      context: ["watch.svg", "runner-era-card.svg"],
      photos: ["glasses.svg"],
      share: ["two-finish.svg"],
    });
  });
});
