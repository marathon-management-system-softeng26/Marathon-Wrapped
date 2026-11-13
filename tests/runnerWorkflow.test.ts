// @vitest-environment jsdom

import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RunnerSelection from "@/app/components/RunnerSelection";

vi.mock("next/navigation", () => ({ useRouter: () => ({}) }));

const fetcher = vi.fn<typeof fetch>();
let container: HTMLDivElement;
let root: Root;

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

const runner = { id: "runner-a", name: "Dewi Kartika", bib_number: "A1205", event: "Soekarno Run", category: "5K" };
const cases = [
  ["setup_required", "connect", "Connect Strava", "setup"],
  ["setup_required", "attach", "Use Strava for this race", "setup"],
  ["authorizing", "check_authorization", "Check Strava authorization", "setup"],
  ["importing", "importing", "Finding your race activity…", "status"],
  ["needs_confirmation", "confirm", "Choose your race activity", "setup"],
  ["no_match", "review_import", "Check your Strava activity", "setup"],
  ["building", "building", "Building your Wrapped…", "status"],
  ["failed", "failed", "Wrapped is unavailable", "status"],
  ["reauth_required", "reauthorize", "Reconnect Strava", "setup"],
  ["ready", "view", "View Wrapped", "wrapped"],
] as const;

async function renderDashboard() {
  await act(async () => root.render(createElement(RunnerSelection)));
}

describe("runner registration desk", () => {
  it("offers a labeled claim form first when the account has no registrations", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ runners: [], events: [] }));
    await renderDashboard();

    const form = container.querySelector("main form");
    expect(form?.querySelector("label")?.textContent).toBe("Claim code");
    expect(form?.querySelector("label")?.control).toBe(form?.querySelector("input"));
    expect(form?.querySelector("button[type=submit]")?.textContent).toBe("Claim my registration");
    expect(container.textContent).not.toContain("Ask the organizer to link");
  });

  it("presents exactly one next step in each runner's entry", async () => {
    fetcher.mockResolvedValueOnce(Response.json({
      runners: cases.map(([workflowState, primaryAction], index) => ({ ...runner, id: `runner-${index}`, workflowState, primaryAction })),
      events: [],
    }));
    await renderDashboard();

    const rows = container.querySelectorAll("main ul li");
    expect(rows).toHaveLength(cases.length);
    cases.forEach(([, , label, kind], index) => {
      const row = rows[index];
      expect(row.textContent).toContain(runner.name);
      expect(row.textContent).toContain(runner.event);
      expect(row.textContent).toContain(runner.category);
      expect(row.textContent).toContain(runner.bib_number);
      const actions = row.querySelectorAll("a, button, [role=status]");
      expect(actions).toHaveLength(1);
      expect(actions[0].textContent).toBe(label);
      if (kind !== "status") {
        const destination = kind === "wrapped" ? `/wrapped/runner-${index}` : `/runners/runner-${index}/strava`;
        expect(actions[0].getAttribute("href")).toBe(destination);
        expect(actions[0].hasAttribute("aria-label")).toBe(false);
        const context = document.getElementById(actions[0].getAttribute("aria-describedby") ?? "");
        expect(context?.textContent).toContain(runner.name);
      } else {
        expect(actions[0].getAttribute("role")).toBe("status");
        expect(actions[0].hasAttribute("tabindex")).toBe(false);
      }
    });
  });

  it("posts a claim once, then clears the code and reloads the registrations", async () => {
    let finishClaim: (response: Response) => void = () => {};
    fetcher.mockResolvedValueOnce(Response.json({ runners: [], events: [] }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishClaim = resolve; }))
      .mockResolvedValueOnce(Response.json({ runners: [{ ...runner, workflowState: "setup_required", primaryAction: "connect" }], events: [] }));
    await renderDashboard();

    const form = container.querySelector<HTMLFormElement>("main form")!;
    const input = form.querySelector("input")!;
    const button = form.querySelector("button")!;
    const code = "q".repeat(43);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(input, ` ${code} `);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form.requestSubmit();
      form.requestSubmit();
    });
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect(button.disabled).toBe(true);
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(["/api/session", "/api/claims"]);
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify({ token: code }) });

    await act(async () => finishClaim(Response.json({ status: "claimed" })));
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(["/api/session", "/api/claims", "/api/session"]);
    expect(container.querySelector("main form input")).toBe(input);
    expect(input.value).toBe("");
    expect(container.querySelector("main form [role=status]")?.textContent).toBe("Registration claimed.");
    expect(container.querySelector("main li a")?.textContent).toBe("Connect Strava");
  });

  it("announces a rejected claim without clearing the code or reloading the catalog", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ runners: [], events: [] }))
      .mockResolvedValueOnce(Response.json({ error: "This claim is invalid or no longer available." }, { status: 400 }));
    await renderDashboard();

    const form = container.querySelector<HTMLFormElement>("main form")!;
    const input = form.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "bad-code");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
    });

    expect(form.querySelector("[role=alert]")?.textContent).toBe("This claim is invalid or no longer available.");
    expect(input.value).toBe("bad-code");
    expect(form.querySelector("button")?.disabled).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
