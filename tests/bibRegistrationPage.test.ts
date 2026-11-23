// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import Register from "@/app/register/page";

const firstResult = {
  ticket: "a".repeat(43),
  match: { bib: "00123", name: "Rani Prima", distance: "5K" },
};
const secondResult = {
  ticket: "b".repeat(43),
  match: { bib: "00456", name: "Dewi Kartika", distance: "10K" },
};

describe("BIB registration page", () => {
  const fetchMock = vi.fn<typeof fetch>();
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.history.replaceState({}, "", "/register");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(Register)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function fill(name: string, value: string) {
    const input = container.querySelector<HTMLInputElement>('input[name="' + name + '"]');
    expect(input, "Missing input " + name).not.toBeNull();
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(input, value);
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function submit() {
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  }

  async function click(label: string) {
    const button = [...container.querySelectorAll("button")].find((node) => node.textContent === label);
    expect(button, "Missing button " + label).toBeDefined();
    await act(async () => button!.click());
  }

  it("requires reviewing and accepting the result before sending credentials", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(firstResult))
      .mockResolvedValueOnce(Response.json({ accepted: true }))
      .mockResolvedValueOnce(Response.json({ requiresEmailConfirmation: true }, { status: 201 }));

    expect(container.querySelector("[name=email]")).toBeNull();
    await fill("eventId", "17");
    await fill("bib", "00123");
    await submit();

    expect(container.textContent).toContain("Rani Prima");
    expect(container.textContent).toContain("00123");
    expect(container.textContent).toContain("5K");
    expect(container.querySelector("[name=email]")).toBeNull();
    await click("This is my result");
    await fill("email", "runner@example.test");
    await fill("password", "password-123");
    await submit();

    expect(container.textContent).toContain("Check your inbox");
    expect(fetchMock.mock.calls.map(([url, options]) => [url, JSON.parse(String(options?.body))])).toEqual([
      ["/api/auth/bib/lookup", { eventId: 17, bib: "00123" }],
      ["/api/auth/bib/accept", { ticket: firstResult.ticket }],
      ["/api/auth/register", { email: "runner@example.test", password: "password-123" }],
    ]);
  });

  it("rejects the preview before letting the runner enter another BIB", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(firstResult))
      .mockResolvedValueOnce(Response.json({ accepted: false }));

    await fill("bib", "00123");
    await submit();
    await click("Use a different BIB");

    expect(container.querySelector("[name=bib]")).not.toBeNull();
    expect(container.textContent).not.toContain("Rani Prima");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/auth/bib/accept", expect.objectContaining({
      method: "DELETE", body: JSON.stringify({ ticket: firstResult.ticket }),
    }));
  });

  it("ignores a lookup response that arrives after the BIB changes", async () => {
    let finishFirstLookup!: (value: Response) => void;
    const firstLookup = new Promise<Response>((resolve) => { finishFirstLookup = resolve; });
    fetchMock
      .mockReturnValueOnce(firstLookup)
      .mockResolvedValueOnce(Response.json(secondResult));

    await fill("bib", "00123");
    await submit();
    await fill("bib", "00456");
    await submit();
    await act(async () => finishFirstLookup(Response.json(firstResult)));

    expect(container.textContent).toContain("Dewi Kartika");
    expect(container.textContent).not.toContain("Rani Prima");
  });

  it("lets an existing account link an accepted result without entering credentials", async () => {
    window.history.replaceState({}, "", "/register?link=1");
    await act(async () => root.render(createElement(Register)));
    fetchMock
      .mockResolvedValueOnce(Response.json(firstResult))
      .mockResolvedValueOnce(Response.json({ accepted: true }))
      .mockResolvedValueOnce(Response.json({ status: "linked" }));

    await fill("bib", "00123");
    await submit();
    await click("This is my result");
    expect(container.querySelector("[name=email]")).toBeNull();
    await submit();

    expect(container.textContent).toContain("Your result is linked");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/auth/bib/link", expect.objectContaining({
      method: "POST", body: "{}",
    }));
  });

  it("sends a single account submission when the form submits twice", async () => {
    let finishSignup!: (value: Response) => void;
    const signup = new Promise<Response>((resolve) => { finishSignup = resolve; });
    fetchMock
      .mockResolvedValueOnce(Response.json(firstResult))
      .mockResolvedValueOnce(Response.json({ accepted: true }))
      .mockReturnValue(signup);

    await fill("bib", "00123");
    await submit();
    await click("This is my result");
    await fill("email", "runner@example.test");
    await fill("password", "password-123");

    const form = container.querySelector("form")!;
    await act(async () => {
      form.requestSubmit();
      form.requestSubmit();
    });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/auth/register")).toHaveLength(1);
    await act(async () => finishSignup(Response.json({ requiresEmailConfirmation: true }, { status: 201 })));
  });
});
