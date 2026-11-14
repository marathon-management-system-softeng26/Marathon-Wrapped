// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecapStory from "@/app/components/RecapStory";
import { privateFields, ready, registration, runnerId, snapshot } from "./fixtures/stravaWrapped";

vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));
vi.mock("@/app/components/SharePreview", () => ({
  default: () => React.createElement("canvas", { "aria-label": "Wrapped preview" }),
}));

let container: HTMLDivElement;
let root: Root;
const fetcher = vi.fn<typeof fetch>();

async function renderRecap() {
  await act(async () => root.render(React.createElement(RecapStory, { runnerId })));
}

async function openSlide(index: number) {
  for (let step = 0; step < index; step += 1) {
    const next = [...container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Next page");
    await act(async () => next!.click());
  }
}

/** Text from every scene, so an assertion cannot pass only because a slide is hidden. */
async function wholeStory() {
  let text = container.textContent ?? "";
  for (let slide = 1; slide < 7; slide += 1) {
    const next = [...container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Next page");
    await act(async () => next!.click());
    text += container.textContent ?? "";
  }
  return text;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  vi.stubGlobal("fetch", fetcher.mockReset());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("Strava-only showcase", () => {
  it("shows the recorded distance with both moving and elapsed time", async () => {
    fetcher.mockImplementationOnce(async () => Response.json(ready));
    await renderRecap();
    await openSlide(2);

    expect(container.textContent).toContain("5.1");
    expect(container.textContent).toContain("24:08");
    expect(container.textContent).toContain("25:23");
    expect(container.textContent).toContain("4:44");
    expect(container.textContent).toMatch(/elapsed/i);
  });

  it("tells the kilometer story with the fastest split and the pace trend", async () => {
    fetcher.mockImplementationOnce(async () => Response.json(ready));
    await renderRecap();
    await openSlide(3);

    const chart = container.querySelector("[role=img]");
    expect(chart?.getAttribute("aria-label")).toMatch(/kilometer/i);
    expect(container.textContent).toContain("Fastest kilometer 2");
    expect(container.textContent).toContain("4:40");
    expect(container.textContent).toMatch(/faster/i);
    expect(container.textContent).toContain("4:50");
  });

  it("credits Strava as the source of every displayed measurement", async () => {
    fetcher.mockImplementationOnce(async () => Response.json(ready));
    await renderRecap();

    expect(await wholeStory()).toContain("Powered by Strava");
  });

  it("shows optional health measurements and the photo and export steps", async () => {
    fetcher.mockImplementationOnce(async () => Response.json(ready));
    await renderRecap();
    const story = await wholeStory();

    expect(story).toContain("147.37");
    expect(story).toContain("62.81");
    expect(story).toContain("photo");
    expect(story).toContain("1080");
    expect(story).toContain("1350");
  });

  it("omits optional sections instead of inventing zeros when Strava has no value", async () => {
    const bare = {
      ...ready,
      snapshot: {
        ...snapshot, splits: [], fastestKilometer: null, slowestKilometer: null, paceTrend: null,
        averagePaceSecondsPerKm: null, averageSpeedMps: null, maxSpeedMps: null,
        averageHeartrate: null, maxHeartrate: null, elevationGainMeters: null, calories: null, averageCadence: null,
      },
      photos: [],
    };
    fetcher.mockImplementationOnce(async () => Response.json(bare));
    await renderRecap();
    const story = await wholeStory();

    expect(story).toContain("No kilometer splits available");
    expect(story).toMatch(/pace unavailable/i);
    expect(story).not.toMatch(/Fastest kilometer/);
    expect(story).not.toMatch(/\b0 bpm\b|\b0 m\b|\b0 kcal\b/);
    expect(story).not.toContain("0:00");
  });

  it("never discloses ranking, chip timing, routes, or provider identifiers", async () => {
    fetcher.mockImplementationOnce(async () => Response.json(ready));
    await renderRecap();
    const story = await wholeStory();

    for (const secret of [String(privateFields.activityId), String(privateFields.athleteId),
      String(privateFields.category_rank), String(privateFields.category_percentile),
      String(privateFields.overtakes), "-6.175392", "106.827153"]) {
      expect(story).not.toContain(secret);
    }
    expect(story).not.toMatch(/rank|percentile|overtak|chip|finisher|DNF|route map/i);
  });

  it("rejects a snapshot carrying fields outside the stored contract instead of rendering it", async () => {
    fetcher.mockImplementationOnce(async () => Response.json({
      ...ready, snapshot: { ...snapshot, ...privateFields },
    }));
    await renderRecap();

    expect(container.querySelector("h1")?.textContent).toBe("Your Wrapped could not be built");
    expect(container.querySelector(".story")).toBeNull();
    for (const secret of [String(privateFields.athleteId), String(privateFields.category_rank),
      String(privateFields.overtakes), "-6.175392"]) {
      expect(container.textContent).not.toContain(secret);
    }
    const setup = [...container.querySelectorAll("a")].find((link) => link.getAttribute("href") === `/runners/${runnerId}/strava`);
    expect(setup).toBeTruthy();
  });
});

describe("recap route before the snapshot is ready", () => {
  it.each([
    ["setup_required", "Connect Strava to create your Wrapped"],
    ["importing", "Finding your race activity"],
    ["building", "Building your Wrapped"],
    ["no_match", "No matching race activity found"],
    ["reauth_required", "Reconnect your Strava account"],
  ])("shows the %s state and links to the setup screen", async (state, title) => {
    fetcher.mockImplementationOnce(async () => Response.json({ state, registration }));
    await renderRecap();

    expect(container.querySelector("h1")?.textContent).toBe(title);
    expect(container.textContent).toContain(registration.runner.name);
    const setup = [...container.querySelectorAll("a")].find((link) => link.getAttribute("href") === `/runners/${runnerId}/strava`);
    expect(setup).toBeTruthy();
    expect(container.querySelector(".story")).toBeNull();
    expect(container.textContent).not.toContain("Save image");
  });

  it("does not fabricate a showcase for a failed Wrapped", async () => {
    fetcher.mockImplementationOnce(async () => Response.json({ state: "failed", registration }));
    await renderRecap();

    expect(container.textContent).toContain("A Wrapped recap is unavailable for this registration.");
    expect(container.textContent).not.toContain("5.1");
    expect(container.querySelector("canvas")).toBeNull();
  });
});
