import { afterEach, describe, expect, it, vi } from "vitest";
import { exportWrapped } from "@/lib/exportWrapped";
import { privateFields, ready, snapshot } from "./fixtures/stravaWrapped";

function mockCanvas(blob: Blob | null = null) {
  const ctx = { fillRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn() };
  const canvas = { getContext: vi.fn(() => ctx), toBlob: (callback: (value: Blob | null) => void) => callback(blob), width: 0, height: 0 };
  const append = vi.fn();
  const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  const createElement = vi.fn((element: string) => element === "canvas" ? canvas : anchor);
  vi.stubGlobal("document", { fonts: { load: async () => {}, ready: Promise.resolve() }, createElement, body: { append } });
  return { ctx, canvas, append, createElement, anchor };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Wrapped PNG export", () => {
  it("draws Strava moving time, pace and splits without chip, provider identity, location or health data", async () => {
    const { ctx, canvas, anchor } = mockCanvas(new Blob(["png"], { type: "image/png" }));
    vi.stubGlobal("window", { setTimeout: vi.fn() });
    const objectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:wrapped");
    const payload = { ...ready, ...privateFields };

    await exportWrapped(payload);

    const drawn = ctx.fillText.mock.calls.map(([value]) => String(value));
    expect(drawn).toEqual(expect.arrayContaining([
      "24:08 moving time", "4:44 /km average pace", "Km 1 · 4:50 /km", "Km 2 · 4:40 /km",
      "Aina Putri · BIB A1001", "Soekarno Run",
    ]));
    expect(drawn.join("\n")).not.toMatch(/rank|percentile|overtake|coordinate|latitude|longitude|activity.?id|athlete.?id|heart.?rate|cadence|elevation|calories|24:08 finish|25:23|45:36/i);
    for (const privateValue of [privateFields.activityId, privateFields.athleteId, ...privateFields.coordinates,
      privateFields.category_rank, privateFields.category_percentile, privateFields.overtakes, snapshot.averageHeartrate,
      snapshot.maxHeartrate, snapshot.elevationGainMeters, snapshot.calories, snapshot.averageCadence]) {
      expect(drawn.join("\n")).not.toContain(String(privateValue));
    }
    expect([canvas.width, canvas.height]).toEqual([1080, 1350]);
    expect(objectUrl).toHaveBeenCalledOnce();
    expect(anchor.download).toBe("wrapped-A1001.png");
    expect(anchor.click).toHaveBeenCalledOnce();
  });

  it("prints absence copy for missing splits and pace", async () => {
    const { ctx } = mockCanvas();
    const payload = { ...ready, snapshot: { ...snapshot, splits: [], averagePaceSecondsPerKm: null } };
    await expect(exportWrapped(payload)).rejects.toThrow("Could not create image. Retry");
    expect(ctx.fillText.mock.calls.map(([value]) => value)).toEqual(expect.arrayContaining([
      "No kilometer splits available", "Average pace unavailable",
    ]));
  });

  it("rejects a non-ready snapshot before creating a canvas or download", async () => {
    const { createElement, append } = mockCanvas();
    const payload = { ...ready, state: "building" } as const;
    await expect(exportWrapped(payload)).rejects.toThrow("Your Wrapped is not ready to share.");
    expect(createElement).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it("reports canvas unavailability without creating a download", async () => {
    const createElement = vi.fn(() => ({ getContext: () => null }));
    vi.stubGlobal("document", { fonts: { load: async () => {}, ready: Promise.resolve() }, createElement });
    await expect(exportWrapped(ready)).rejects.toThrow("Image export is unavailable");
    expect(createElement).toHaveBeenCalledTimes(1);
  });

  it("reports blob failure without attempting a download", async () => {
    const { append } = mockCanvas();
    await expect(exportWrapped(ready)).rejects.toThrow("Could not create image. Retry");
    expect(append).not.toHaveBeenCalled();
  });
});
