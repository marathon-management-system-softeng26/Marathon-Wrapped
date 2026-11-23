// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AuthMasthead from "@/app/components/AuthMasthead";
import AuthPanel from "@/app/components/AuthPanel";
import RunnerFeedback from "@/app/components/RunnerFeedback";

describe("runner identity shell", () => {
  it("keeps the race image decorative while exposing one readable event heading", () => {
    const html = renderToStaticMarkup(createElement(AuthMasthead));

    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("h1")?.textContent).toBe("Soekarno Run 2027");
    expect(document.querySelector("[role=img]")).toBeNull();
    expect(document.querySelector("[aria-hidden=true]")).not.toBeNull();
  });

  it("gives forms a shared labelled panel without owning their behavior", () => {
    const html = renderToStaticMarkup(createElement(
      AuthPanel,
      { title: "Back to your race.", footer: createElement("a", { href: "/register" }, "Create account") },
      createElement("form", null, createElement("button", { type: "submit" }, "Find my race")),
    ));

    const document = new DOMParser().parseFromString(html, "text/html");
    const panel = document.querySelector("section");
    const title = document.querySelector("h2");
    expect(panel?.getAttribute("aria-labelledby")).toBe(title?.id);
    expect(panel?.querySelector("form button")?.textContent).toBe("Find my race");
    expect(panel?.querySelector("footer a")?.getAttribute("href")).toBe("/register");
  });

  it.each([
    ["status", "status"],
    ["empty", "status"],
    ["error", "alert"],
  ] as const)("announces %s feedback with the correct live role", (kind, role) => {
    const html = renderToStaticMarkup(createElement(
      RunnerFeedback,
      { kind, title: "Result state" },
      createElement("p", null, "Next action"),
    ));

    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelector(`[role=${role}]`)?.textContent).toContain("Result state");
    expect(document.querySelector(`[role=${role}]`)?.textContent).toContain("Next action");
  });
});
