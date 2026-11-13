// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrganizerRunnerAccess from "@/app/components/OrganizerRunnerAccess";
import OrganizerStravaRaceConfig from "@/app/components/OrganizerStravaRaceConfig";

const fetcher = vi.fn<typeof fetch>();
let container: HTMLDivElement;
let root: Root;

const runnerId = "11111111-1111-1111-1111-111111111111";
const rows = [
  { runner_id: runnerId, bib_number: "A1001", name: "Aina Putri", category: "5K", linked: false },
  { runner_id: "22222222-2222-2222-2222-222222222222", bib_number: "A1002", name: "Budi Santoso", category: "5K", linked: true },
];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

const find = (label: string) =>
  [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === label);

describe("organizer runner access", () => {
  async function render() {
    await act(async () => root.render(createElement(OrganizerRunnerAccess, { eventId: "1", rows })));
  }

  it("reports claimed and unclaimed registrations without naming the account", async () => {
    await render();

    const text = container.textContent ?? "";
    expect(text).toContain("A1001");
    expect(text).toContain("Not claimed");
    expect(text).toContain("Claimed");
    expect(text).not.toMatch(/@|email|user id/i);
  });

  it("shows a one-time code with its expiry and copy guidance, then allows revoking it", async () => {
    fetcher.mockImplementationOnce(async () => Response.json(
      { id: "33333333-3333-3333-3333-333333333333", token: "z".repeat(43), expiresAt: "2027-08-10T09:00:00.000Z" },
      { status: 201 },
    ));
    await render();
    await act(async () => find("Create claim code")!.click());

    expect(fetcher.mock.calls[0]).toEqual([
      `/api/organizer/events/1/runners/${runnerId}/claim`,
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    ]);
    const text = container.textContent ?? "";
    expect(text).toContain("z".repeat(43));
    expect(text).toMatch(/shown once/i);
    expect(text).toMatch(/10 Aug 2027/);

    fetcher.mockImplementationOnce(async () => Response.json({ ok: true }));
    await act(async () => find("Revoke claim code")!.click());
    expect(fetcher.mock.calls[1]?.[0]).toBe(`/api/organizer/events/1/runners/${runnerId}/claim`);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE", body: JSON.stringify({ claimId: "33333333-3333-3333-3333-333333333333" }) });
    expect(container.textContent).not.toContain("z".repeat(43));
  });

  it("reports a refused claim without displaying a code", async () => {
    fetcher.mockImplementationOnce(async () => Response.json({ error: "Runner not found for this event." }, { status: 404 }));
    await render();
    await act(async () => find("Create claim code")!.click());

    expect(container.querySelector("[role=alert]")?.textContent).toBe("Runner not found for this event.");
    expect(container.querySelector("code")).toBeNull();
    expect(find("Revoke claim code")).toBeUndefined();
  });
});

describe("organizer Strava race configuration form", () => {
  async function render() {
    await act(async () => root.render(createElement(OrganizerStravaRaceConfig, { eventId: "1" })));
  }

  const loaded = {
    categories: [{
      id: 7, name: "5K",
      config: {
        categoryId: 7, startTimeFrom: "2027-08-16T23:00:00.000Z", startTimeTo: "2027-08-17T05:00:00.000Z",
        allowedSportTypes: ["Run"], distanceToleranceM: 400, startLatitude: null, startLongitude: null, startRadiusM: null,
      },
    }],
  };

  it("loads each category's window and tolerance for editing", async () => {
    fetcher.mockImplementationOnce(async () => Response.json(loaded));
    await render();

    expect(fetcher.mock.calls[0][0]).toBe("/api/organizer/events/1/strava-config");
    expect(container.textContent).toContain("5K");
    expect(container.querySelector<HTMLInputElement>("input[name=distanceToleranceM]")?.value).toBe("400");
    expect(container.querySelectorAll("label").length).toBeGreaterThan(2);
  });

  it("confirms a saved configuration", async () => {
    // A successful save reloads the stored settings, so the refetch needs a reply too.
    fetcher.mockImplementationOnce(async () => Response.json(loaded))
      .mockImplementationOnce(async () => Response.json({ config: loaded.categories[0].config }))
      .mockImplementation(async () => Response.json(loaded));
    await render();
    const form = container.querySelector("form")!;
    await act(async () => form.requestSubmit());

    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: "PUT", credentials: "same-origin" });
    expect(container.querySelector("[role=status]")?.textContent).toMatch(/saved/i);
  });

  it("surfaces a server validation message without claiming success", async () => {
    fetcher.mockImplementationOnce(async () => Response.json(loaded))
      .mockImplementationOnce(async () => Response.json({ error: "The window end must come after the window start." }, { status: 422 }));
    await render();
    await act(async () => container.querySelector("form")!.requestSubmit());

    expect(container.querySelector("[role=alert]")?.textContent).toBe("The window end must come after the window start.");
    expect(container.querySelector("[role=status]")?.textContent).not.toMatch(/saved/i);
  });
});
