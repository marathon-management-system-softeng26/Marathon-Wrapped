import { describe, expect, it } from "vitest";
import { ainaInput } from "./fixtures/runners";
import { buildWrappedStats } from "@/lib/stats";
import { mergeWrapped } from "@/lib/merge";
import type { Photo } from "@/lib/wrappedPayload";
const photo = (bib: string): Photo => ({ id: bib, bib_number: bib, photo_url: "/photos/demo-race.jpg", photographer: "Demo stock", captured_km: null, captured_at: null });
describe("photo identity isolation", () => {
  it("does not merge another BIB's photo into a runner's recap", () => {
    const payload = mergeWrapped(buildWrappedStats(ainaInput()), { strava: { state: "disconnected", metrics: null }, photos: [photo("A1001"), photo("B1001")], warnings: [] });
    if (payload.status === "unavailable") throw new Error("Expected chip stats");
    expect(payload.photos.map(p => p.bib_number)).toEqual(["A1001"]);
  });
  it("does not match photos without an assigned BIB", () => {
    const payload = mergeWrapped(buildWrappedStats({ ...ainaInput(), bib_number: null }), { strava: { state: "disconnected", metrics: null }, photos: [photo("A1001")], warnings: [] });
    if (payload.status === "unavailable") throw new Error("Expected chip stats");
    expect(payload.photos).toEqual([]);
  });
});
