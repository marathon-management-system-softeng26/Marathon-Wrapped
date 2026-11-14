// @vitest-environment jsdom

import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RunnerSelection from "@/app/components/RunnerSelection";
import {
  captureClaimToken,
  claimTokenSnapshot,
  clearClaimToken,
  resetClaimHandoff,
  serverClaimTokenSnapshot,
  subscribeClaimToken,
} from "@/app/components/claimHandoff";

vi.mock("next/navigation", () => ({ useRouter: () => ({}) }));

const fetcher = vi.fn<typeof fetch>();
const token = "z".repeat(43);
let container: HTMLDivElement;
let root: Root;

const visit = (search: string) => window.history.replaceState(null, "", `/${search}`);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  vi.stubGlobal("fetch", fetcher.mockReset());
  window.sessionStorage.clear();
  resetClaimHandoff();
  visit("");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.sessionStorage.clear();
  resetClaimHandoff();
  visit("");
  vi.unstubAllGlobals();
});

describe("claim token handoff", () => {
  it("lifts the token out of the URL so no copy is left behind", () => {
    visit(`?claim=${token}`);

    captureClaimToken();

    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain(token);
    expect(claimTokenSnapshot()).toBe(token);
  });

  it("keeps any other query parameters intact", () => {
    visit(`?utm=mail&claim=${token}&page=2`);

    captureClaimToken();

    expect(window.location.search).toBe("?utm=mail&page=2");
  });

  it("scrubs a malformed token from the URL without storing it", () => {
    visit("?claim=not-a-real-token");

    captureClaimToken();

    expect(window.location.search).toBe("");
    expect(claimTokenSnapshot()).toBe("");
    expect(window.sessionStorage.getItem("marathon-wrapped:claim")).toBeNull();
  });

  it("does nothing when the URL carries no claim", () => {
    visit("?page=2");

    captureClaimToken();

    expect(window.location.search).toBe("?page=2");
    expect(claimTokenSnapshot()).toBe("");
  });

  it("forgets a spent token", () => {
    visit(`?claim=${token}`);
    captureClaimToken();

    clearClaimToken();

    expect(claimTokenSnapshot()).toBe("");
    expect(window.sessionStorage.getItem("marathon-wrapped:claim")).toBeNull();
  });

  it("survives storage being unavailable", () => {
    visit(`?claim=${token}`);
    const storage = vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => captureClaimToken()).not.toThrow();
    expect(window.location.search).toBe("");
    // The page still holds it, so the runner is not sent back to the mail.
    expect(claimTokenSnapshot()).toBe(token);

    storage.mockRestore();
  });

  it("recovers a token stored before a sign-in redirect", () => {
    window.sessionStorage.setItem("marathon-wrapped:claim", token);

    const unsubscribe = subscribeClaimToken(() => {});

    expect(claimTokenSnapshot()).toBe(token);
    unsubscribe();
  });

  it("notifies subscribers when a token arrives and prerenders nothing", () => {
    visit(`?claim=${token}`);
    const listener = vi.fn();

    const unsubscribe = subscribeClaimToken(listener);

    expect(claimTokenSnapshot()).toBe(token);
    expect(serverClaimTokenSnapshot()).toBe("");
    unsubscribe();
    expect(subscribeClaimToken(listener)).toBeTypeOf("function");
  });
});

describe("claim form prefill", () => {
  const render = async () => act(async () => root.render(createElement(RunnerSelection)));
  const field = () => container.querySelector<HTMLInputElement>("main form input");
  const form = () => container.querySelector<HTMLFormElement>("main form");

  it("fills the code from a mailed link and asks for an explicit press", async () => {
    visit(`?claim=${token}`);
    fetcher.mockResolvedValueOnce(Response.json({ runners: [], events: [] }));

    await render();

    expect(field()?.value).toBe(token);
    expect(container.textContent).toMatch(/filled in/i);
    expect(window.location.search).toBe("");
    // Nothing is claimed until the runner presses the button.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/session");
  });

  it("claims the prefilled code when the runner presses the button", async () => {
    visit(`?claim=${token}`);
    fetcher.mockResolvedValueOnce(Response.json({ runners: [], events: [] }));
    await render();

    fetcher.mockResolvedValueOnce(Response.json({ status: "claimed" }));
    fetcher.mockResolvedValue(Response.json({ runners: [], events: [] }));
    await act(async () => form()!.requestSubmit());

    expect(fetcher.mock.calls[1][0]).toBe("/api/claims");
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ token });
    expect(field()?.value).toBe("");
    expect(claimTokenSnapshot()).toBe("");
  });

  it("forgets a prefilled code the server rejects", async () => {
    visit(`?claim=${token}`);
    fetcher.mockResolvedValueOnce(Response.json({ runners: [], events: [] }));
    await render();

    fetcher.mockResolvedValueOnce(Response.json({ error: "no" }, { status: 400 }));
    await act(async () => form()!.requestSubmit());

    expect(container.querySelector("[role=alert]")?.textContent).toMatch(/no longer available/i);
    expect(window.sessionStorage.getItem("marathon-wrapped:claim")).toBeNull();
  });

  it("lets the runner replace a prefilled code by typing", async () => {
    visit(`?claim=${token}`);
    fetcher.mockResolvedValueOnce(Response.json({ runners: [], events: [] }));
    await render();

    const input = field()!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "typed-by-hand");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(field()?.value).toBe("typed-by-hand");
    expect(container.textContent).toMatch(/Enter the code from your race organizer/i);
  });

  it("leaves the field empty with no mailed link", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ runners: [], events: [] }));

    await render();

    expect(field()?.value).toBe("");
    expect(container.textContent).toMatch(/Enter the code from your race organizer/i);
  });

  it("saves the token before the sign-in redirect takes the URL away", async () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: `http://localhost/?claim=${token}`, search: `?claim=${token}`, pathname: "/", hash: "", replace },
    });
    fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));

    await render();

    expect(replace).toHaveBeenCalledWith("/login");
    expect(window.sessionStorage.getItem("marathon-wrapped:claim")).toBe(token);
  });
});
