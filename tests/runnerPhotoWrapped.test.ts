import { describe, expect, it } from "vitest";
import { mergePersonalRunnerPhotos } from "@/lib/runnerPhotos/wrapped";
import { personalPhoto, photo, ready, registration } from "./fixtures/stravaWrapped";

describe("personal photo selection in Wrapped", () => {
  it("replaces the selection on refresh, preserving organizer photos and stats", () => {
    const selected = mergePersonalRunnerPhotos(ready, [personalPhoto]);
    expect(selected).toStrictEqual({ ...ready, photos: [personalPhoto, photo] });
    expect(mergePersonalRunnerPhotos(selected, [personalPhoto])).toStrictEqual(selected);
    expect(mergePersonalRunnerPhotos(selected, [])).toStrictEqual(ready);
    expect(ready.photos).toEqual([photo]);
  });

  it("leaves a non-ready workflow unchanged", () => {
    const waiting = { state: "building" as const, registration, photos: [] };
    expect(mergePersonalRunnerPhotos(waiting, [personalPhoto])).toBe(waiting);
  });
});
