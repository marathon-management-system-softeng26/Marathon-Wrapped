// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RunnerStravaSetup from "@/app/components/RunnerStravaSetup";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {} }) }));

const runnerId = "11111111-1111-1111-1111-111111111111";
const fetcher = vi.fn<typeof fetch>();
let container: HTMLDivElement;
let root: Root;

const route = (status: string, extra: Record<string, unknown> = {}) =>
  Response.json({ status, activityId: null, candidates: [], metrics: {}, ...extra });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetcher.mockReset());
  window.history.replaceState(null, "", `/runners/${runnerId}/strava`);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render(feedbackCode: string | null = null) {
  await act(async () => root.render(createElement(RunnerStravaSetup, { runnerId, feedbackCode })));
}
const buttons = () => [...container.querySelectorAll("button")].map((button) => button.textContent);

describe("runner Strava setup screen", () => {
  it("reads owner-scoped state once and offers this race its own attachment", async () => {
    fetcher.mockImplementationOnce(async () => route("attachable"));
    await render();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(`/api/runners/${runnerId}/strava`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store", credentials: "same-origin" });
    expect(buttons()).toContain("Use Strava for this race");
    expect(container.textContent).toContain("private");
  });

  it("sends attachment and per-race detach to runner-scoped endpoints", async () => {
    // The action POST is followed by a refresh read, so both need a stored reply.
    fetcher.mockImplementationOnce(async () => route("attachable")).mockImplementation(async () => route("importing"));
    await render();
    const attach = [...container.querySelectorAll("button")].find((button) => button.textContent === "Use Strava for this race")!;
    await act(async () => attach.click());
    expect(fetcher.mock.calls[1]).toEqual([`/api/runners/${runnerId}/strava/attach`, expect.objectContaining({ method: "POST" })]);

    const detach = [...container.querySelectorAll("button")].find((button) => button.textContent === "Remove Strava from this race");
    expect(detach).toBeTruthy();
    fetcher.mockImplementation(async () => route("attachable"));
    await act(async () => detach!.click());
    expect(fetcher.mock.calls.some(([path]) => path === `/api/runners/${runnerId}/strava/detach`)).toBe(true);
    expect(fetcher.mock.calls.every(([path]) => path !== "/api/strava/disconnect")).toBe(true);
  });

  it("keeps account disconnect distinct from per-race detach", async () => {
    fetcher.mockImplementationOnce(async () => route("matched", { activityId: "10" }));
    await render();
    expect(buttons()).toEqual(expect.arrayContaining(["Remove Strava from this race", "Disconnect Strava"]));

    fetcher.mockImplementation(async () => route("disconnected"));
    const disconnect = [...container.querySelectorAll("button")].find((button) => button.textContent === "Disconnect Strava")!;
    await act(async () => disconnect.click());
    expect(fetcher.mock.calls.some(([path]) => path === "/api/strava/disconnect")).toBe(true);
  });

  it("announces callback feedback and removes it from the address bar", async () => {
    window.history.replaceState(null, "", `/runners/${runnerId}/strava?strava=insufficient_scope&keep=yes`);
    fetcher.mockImplementationOnce(async () => route("reauth_required"));
    await render("insufficient_scope");

    expect(container.querySelector("[role=status]")?.textContent).toBe("Allow activity access in Strava to connect your race activity.");
    expect(window.location.search).toBe("?keep=yes");
  });

  it("never echoes an unrecognized provider code back to the reader", async () => {
    window.history.replaceState(null, "", `/runners/${runnerId}/strava?strava=private-token`);
    fetcher.mockImplementationOnce(async () => route("disconnected"));
    await render("private-token");

    expect(container.querySelector("[role=status]")?.textContent).toBe("Strava could not connect. Try connecting again.");
    expect(container.textContent).not.toContain("private-token");
    expect(window.location.search).toBe("");
  });

  it("polls while the snapshot is building and stops once it is ready", async () => {
    vi.useFakeTimers();
    fetcher.mockImplementation(async () => route("building", { activityId: "10" }));
    await render();
    expect(container.textContent).toContain("Building your Wrapped");

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetcher.mock.calls.length).toBeGreaterThan(1);
    const polled = fetcher.mock.calls.length;

    fetcher.mockImplementation(async () => route("matched", { activityId: "10" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    const settled = fetcher.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fetcher.mock.calls.length).toBe(settled);
    expect(settled).toBeGreaterThan(polled);
  });

  it("sends an expired session to sign-in instead of a dead end", async () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, replace } });
    fetcher.mockImplementationOnce(async () => Response.json({ error: "Sign in again." }, { status: 401 }));
    await render();

    expect(replace).toHaveBeenCalledWith("/login");
    expect(buttons()).not.toContain("Use Strava for this race");
  });

  it("reports a denied registration without offering Strava controls", async () => {
    fetcher.mockImplementationOnce(async () => Response.json({ error: "not found" }, { status: 404 }));
    await render();

    expect(container.querySelector("[role=alert]")?.textContent).toBe("This registration is not available on your account.");
    expect(buttons()).not.toContain("Use Strava for this race");
  });
});
