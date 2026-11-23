// @vitest-environment jsdom

import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrganizerPanel from "@/app/components/OrganizerPanel";
import { withRaceZone } from "@/lib/raceTime";

vi.mock("next/navigation", () => ({ useRouter: () => ({}), usePathname: () => "/organizer" }));

const fetcher = vi.fn<typeof fetch>();
let container: HTMLDivElement;
let root: Root;

const EVENT = { id: 1, name: "Soekarno Run 2027" };
const results = {
  event: { name: EVENT.name, event_date: "2027-08-17" },
  categories: [
    { name: "5K", min_age: 13 },
    { name: "10K", min_age: 17 },
  ],
  results: [],
};

// Routed by URL rather than call order: the panel mounts three independent fetchers.
function route(path: string) {
  if (path.startsWith("/api/session")) return Response.json({ runners: [], events: [EVENT] });
  if (path.includes("/results")) return Response.json(results);
  if (path.includes("/strava-config")) return Response.json({ categories: [] });
  throw new Error(`unexpected request: ${path}`);
}

const posts = () => fetcher.mock.calls.filter(([, init]) => init && "method" in init!);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  vi.stubGlobal("fetch", fetcher.mockReset().mockImplementation(async (input) => route(String(input))));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const setValue = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};

const labelled = (text: string) =>
  [...container.querySelectorAll("label")].find((label) => label.textContent?.startsWith(text));

const field = (text: string) => labelled(text)?.control as HTMLInputElement | HTMLSelectElement;

async function openEditor() {
  await act(async () => root.render(createElement(OrganizerPanel)));
  const add = [...container.querySelectorAll("button")].find((button) => button.textContent === "Add runner")!;
  await act(async () => add.click());
}

describe("organizer runner editor", () => {
  it("uses the shared organizer shell and grouped editing controls", async () => {
    await openEditor();
    expect(container.querySelector("main.organizer-shell")).not.toBeNull();
    expect(container.querySelector(".runner-editor fieldset")).not.toBeNull();
  });
  it("bounds date of birth by the category's own race-day minimum", async () => {
    await openEditor();

    const dob = field("Date of birth") as HTMLInputElement;
    expect(dob.type).toBe("date");
    // 5K minimum is 13 on 17 Aug 2027, so the newest qualifying birth date is 17 Aug 2014.
    expect(dob.max).toBe("2014-08-17");

    await act(async () => setValue(field("Category"), "10K"));
    expect((field("Date of birth") as HTMLInputElement).max).toBe("2010-08-17");

    await act(async () => setValue(field("Category"), "5K"));
    expect((field("Date of birth") as HTMLInputElement).max).toBe("2014-08-17");
  });

  it("states the rule it is enforcing, using the real race date", async () => {
    await openEditor();
    expect(container.querySelector(".runner-editor > p")?.textContent).toContain(
      "A 5K runner must be 13 on race day (17 Aug 2027). Latest date of birth: 17 Aug 2014.",
    );
  });

  it("refuses to submit an under-age runner and names the reason", async () => {
    await openEditor();
    await act(async () => {
      setValue(field("Name"), "Too Young");
      setValue(field("BIB"), "A1299");
      setValue(field("Date of birth") as HTMLInputElement, "2015-01-01");
    });

    const form = container.querySelector<HTMLFormElement>("form.runner-editor")!;
    await act(async () => form.requestSubmit());

    const alert = container.querySelector(".runner-editor [role=alert]");
    expect(alert?.textContent).toContain("This runner is 12 on race day");
    expect(posts()).toHaveLength(0);
  });

  it("requires recorded consent below 17 before saving", async () => {
    await openEditor();
    await act(async () => {
      setValue(field("Name"), "Needs Consent");
      setValue(field("BIB"), "A1300");
      setValue(field("Date of birth") as HTMLInputElement, "2013-08-17");
    });

    const form = container.querySelector<HTMLFormElement>("form.runner-editor")!;
    await act(async () => form.requestSubmit());
    expect(container.querySelector(".runner-editor [role=alert]")?.textContent).toContain(
      "Under 17 needs recorded parental consent",
    );
    expect(posts()).toHaveLength(0);

    await act(async () => (field("Parental consent recorded") as HTMLInputElement).click());
    expect(container.querySelector(".runner-editor [role=alert]")).toBeNull();
  });

  it("collects chip times as date-and-time choices, not typed offsets", async () => {
    await openEditor();
    await act(async () => setValue(field("Result"), "finisher"));

    for (const label of ["Start time (WIB)", "Finish time (WIB)"]) {
      const input = field(label) as HTMLInputElement;
      expect(input.type).toBe("datetime-local");
      // Seconds must be selectable: a finisher's splits have to total the elapsed time.
      expect(input.step).toBe("1");
      expect(input.placeholder).toBe("");
    }
  });

  it("sends the race's own offset and keeps the seconds the split rule depends on", async () => {
    await openEditor();
    await act(async () => setValue(field("Result"), "finisher"));
    await act(async () => {
      setValue(field("Name"), "Dewi Kartika");
      setValue(field("BIB"), "A1205");
      setValue(field("Date of birth") as HTMLInputElement, "1995-04-12");
      setValue(field("Start time (WIB)") as HTMLInputElement, "2027-08-17T06:00:00");
      setValue(field("Finish time (WIB)") as HTMLInputElement, "2027-08-17T06:25:23");
    });
    for (let km = 1; km <= 5; km += 1) {
      await act(async () => setValue(field(`km ${km}`) as HTMLInputElement, km === 5 ? "323" : "300"));
    }

    const form = container.querySelector<HTMLFormElement>("form.runner-editor")!;
    await act(async () => form.requestSubmit());

    const [, init] = posts()[0];
    const body = JSON.parse(String(init!.body));
    expect(body.result.start_time).toBe("2027-08-17T06:00:00+07:00");
    expect(body.result.finish_time).toBe("2027-08-17T06:25:23+07:00");
    // 4 x 300 + 323 = 1523 seconds, which is exactly the elapsed chip time above.
    expect(body.splits.reduce((total: number, split: { split_seconds: number }) => total + split.split_seconds, 0)).toBe(
      (Date.parse(body.result.finish_time) - Date.parse(body.result.start_time)) / 1000,
    );
  });

  it("shows a stored chip time back in the race's wall clock", async () => {
    // What the database returns is UTC; the organizer must see the time they set.
    fetcher.mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.includes("/runners/") && !init?.method) {
        return Response.json({
          name: "Dewi Kartika", bib_number: "A1205", date_of_birth: "1995-04-12", gender: "F",
          parental_consent: false, category: "5K",
          result: { finisher: true, start_status: "on-time", start_time: "2027-08-16T23:00:00+00:00", finish_time: "2027-08-16T23:25:23+00:00" },
          splits: [], enrichment: { metrics: null, photos: [] },
        });
      }
      if (path.includes("/results")) {
        return Response.json({ ...results, results: [{ runner_id: "r1", name: "Dewi Kartika", bib_number: "A1205", category: "5K", status: "finisher", elapsed_seconds: 1523, category_rank: 1, linked: false }] });
      }
      return route(path);
    });
    await act(async () => root.render(createElement(OrganizerPanel)));
    const edit = [...container.querySelectorAll("button")].find((button) => button.textContent === "Edit")!;
    await act(async () => edit.click());

    // A control normalizes the value it is handed, so assert the round trip rather than its text:
    // what matters is that a stored UTC instant comes back as the same instant in the race's zone.
    const start = field("Start time (WIB)") as HTMLInputElement;
    const finish = field("Finish time (WIB)") as HTMLInputElement;
    expect(start.value.startsWith("2027-08-17T06:00")).toBe(true);
    expect(withRaceZone(start.value)).toBe("2027-08-17T06:00:00+07:00");
    expect(withRaceZone(finish.value)).toBe("2027-08-17T06:25:23+07:00");
  });
});
