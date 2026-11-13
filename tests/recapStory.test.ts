// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecapStory from "@/app/components/RecapStory";
import { ready, registration, runnerId } from "./fixtures/stravaWrapped";

vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
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
  vi.unstubAllGlobals();
});

describe("Strava-first recap controls", () => {
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
