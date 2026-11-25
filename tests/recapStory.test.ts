// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecapStory from "@/app/components/RecapStory";
import { personalPhoto, photo, ready, registration, runnerId } from "./fixtures/stravaWrapped";
import type { OfficialWrappedPayload } from "@/lib/wrappedPayload";

vi.mock("@/app/components/SharePreview", () => ({
  default: () => React.createElement("canvas", { "aria-label": "Wrapped preview" }),
}));

let container: HTMLDivElement;
let root: Root;
const fetcher = vi.fn<typeof fetch>();

async function renderRecap() {
  await act(async () => root.render(React.createElement(RecapStory, { runnerId })));
}

async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
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

describe("Strava-first recap controls", () => {
  it("isolates a failed personal image in the gallery and enlarged view", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ ...ready, photos: [personalPhoto, photo] }));
    await renderRecap();
    await click("Photos");
    const grid = container.querySelector(".photo-grid")!;
    const [personal, organizer] = grid.querySelectorAll("img");
    expect(personal.src).toBe(new URL(personalPhoto.photo_url, window.location.href).href);
    expect(grid.textContent).toMatch(/your photo/i);
    expect(grid.textContent).toMatch(/organizer photo/i);
    const dialog = container.querySelector("dialog")!;
    dialog.showModal = () => { dialog.open = true; };
    await act(async () => personal.closest("button")!.click());
    const enlarged = dialog.querySelector("img")!;
    expect(enlarged.src).toBe(personal.src);
    await act(async () => enlarged.dispatchEvent(new Event("error")));
    expect(dialog.textContent).toMatch(/photo could not load/i);
    await act(async () => { dialog.open = false; dialog.dispatchEvent(new Event("close")); });
    await act(async () => personal.dispatchEvent(new Event("error")));
    expect(grid.textContent).toMatch(/photo could not load/i);
    expect(grid.textContent).not.toContain(personalPhoto.photo_url);
    expect(organizer.isConnected).toBe(true);
    expect(organizer.src).toBe(new URL(photo.photo_url, window.location.href).href);
    await click("Distance");
    expect(container.textContent).toContain("24:08");
    expect(container.textContent).toContain("5.1");
  });

  it.each([true, false])("opens this registration's photo manager from the photo scene (populated: %s)", async (populated) => {
    fetcher.mockResolvedValueOnce(Response.json({ ...ready, photos: populated ? ready.photos : [] }));
    await renderRecap();
    await click("Photos");
    expect(container.querySelector(`main section a[href="/runners/${runnerId}/photos"]`)?.textContent).toBe("Manage my photos");
  });

  it("renders all seven scenes from an official-only result", async () => {
    const official: OfficialWrappedPayload = {
      kind: "official", registration, photos: [], strava: { state: "unavailable" },
      result: { runnerId, eventId: 1, bib: "A1001", name: "Aina Putri", distance: "5K", status: "finished",
        finishTimeMs: 1_999_000, netTimeMs: 1_990_000, overallRank: 12, division: "F30", divisionRank: 4,
        gender: "F", genderRank: 9, checkpoints: [], sourceUrl: null },
    };
    fetcher.mockResolvedValueOnce(Response.json(official));
    await renderRecap();

    expect(container.querySelectorAll("nav[aria-label='Recap pages'] button")).toHaveLength(7);
    expect(container.textContent).toContain("Hi Aina");
    await click("Distance");
    expect(container.textContent).toContain("5.0");
    expect(container.textContent).toContain("33:10");
  });

  it("uses outcome-aware copy for an official DNF", async () => {
    fetcher.mockResolvedValueOnce(Response.json({
      kind: "official", registration, photos: [], strava: { state: "unavailable" },
      result: { runnerId, eventId: 1, bib: "A1001", name: "Aina Putri", distance: "5K", status: "dnf",
        finishTimeMs: null, netTimeMs: null, overallRank: null, division: null, divisionRank: null,
        gender: null, genderRank: null, checkpoints: [], sourceUrl: null },
    }));
    await renderRecap();
    await click("Your race");
    expect(container.textContent).toContain("did not finish");
    expect(container.textContent).not.toMatch(/finisher|average pace/i);
  });
  it.each([
    ["disconnected", 200, "failed"],
    ["disconnecting", 202, "timeout"],
    ["reauthorize_to_disconnect", 409, "failed"],
  ] as const)("clears a ready recap after %s (%i) even if refresh is %s", async (status, code, refreshResult) => {
    let finishRefresh: ((response: Response) => void) | undefined;
    fetcher.mockResolvedValueOnce(Response.json(ready))
      .mockResolvedValueOnce(Response.json({ status }, { status: code }))
      .mockImplementationOnce(() => new Promise((resolve, reject) => {
        if (refreshResult === "timeout") {
          finishRefresh = () => reject(new DOMException("Timed out", "TimeoutError"));
        } else {
          finishRefresh = resolve;
        }
      }));
    await renderRecap();
    await click("Save");
    expect(container.textContent).toContain("Save image");
    expect(container.querySelector("canvas")).not.toBeNull();
    await click("Context");
    expect(container.textContent).toContain("147.37");

    await click("Disconnect Strava");
    expect(fetcher.mock.calls[1][0]).toBe("/api/strava/disconnect");
    expect(finishRefresh).toBeDefined();
    expect(container.querySelector(".story")).toBeNull();

    await act(async () => finishRefresh!(Response.json({ error: "Unavailable" }, { status: 503 })));
    expect(container.textContent).not.toContain("147.37");
    expect(container.textContent).not.toContain("Save image");
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("shows a failed Wrapped without offering an import retry that cannot run", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ state: "failed", registration }));
    await renderRecap();

    expect(container.textContent).toContain("Your Wrapped could not be built");
    expect(container.textContent).not.toMatch(/retry|try again/i);
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("Save image");
  });

  it.each(["import_failed", "authorization_failed"] as const)(
    "keeps recovery instructions out of a failed Wrapped after the %s callback",
    async (callback) => {
      window.history.replaceState(null, "", `/wrapped/${runnerId}?strava=${callback}&keep=yes`);
      let finishLoad: ((response: Response) => void) | undefined;
      fetcher.mockImplementationOnce(() => new Promise((resolve) => { finishLoad = resolve; }));

      await renderRecap();
      const loadingCopy = container.textContent;
      await act(async () => finishLoad!(Response.json({ state: "failed", registration })));

      expect(container.textContent).toContain("A Wrapped recap is unavailable for this registration.");
      expect(container.textContent).not.toMatch(/retry|try connecting again|reconnect/i);
      expect(loadingCopy).not.toMatch(/retry|try connecting again|reconnect/i);
      expect(window.location.search).toBe("?keep=yes");
    },
  );

  it("keeps OAuth feedback on a recap that is still importing", async () => {
    window.history.replaceState(null, "", `/wrapped/${runnerId}?strava=connected`);
    fetcher.mockResolvedValueOnce(Response.json({ state: "importing", registration }));

    await renderRecap();

    expect(container.textContent).toContain("Strava authorized. Checking your race activity.");
  });

  it("clears the export scene when a pending disconnect succeeds after leaving the Strava card", async () => {
    let finishDisconnect: ((response: Response) => void) | undefined;
    fetcher.mockResolvedValueOnce(Response.json(ready))
      .mockImplementationOnce(() => new Promise((resolve) => { finishDisconnect = resolve; }))
      .mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 503 }));
    await renderRecap();
    await click("Context");
    await click("Disconnect Strava");
    await click("Save");
    expect(container.querySelector("canvas")).not.toBeNull();

    await act(async () => finishDisconnect!(Response.json({ status: "disconnected" })));
    expect(container.querySelector(".story")).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });
});
