// @vitest-environment jsdom

import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RunnerPhotoManager from "@/app/components/RunnerPhotoManager";
import type { RunnerPhotoSlot } from "@/lib/runnerPhotos/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({}), usePathname: () => "/runners/race-a/photos" }));
const { from, upload } = vi.hoisted(() => ({ from: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/supabaseBrowser", () => ({ createSupabaseBrowser: () => ({ storage: { from } }) }));

const collection = "/api/runners/race-a/photos";
const item = collection + "/photo-a";
const expiresAt = "2027-11-24T11:10:00.000Z";
const capability = { photoId: "photo-a", path: "staging/opaque", token: "upload-secret", expiresAt };
const ready: RunnerPhotoSlot = {
  id: "photo-a", state: "ready", included: true, createdAt: "2027-11-24T09:10:00.000Z",
  expiresAt: null, contentUrl: item + "/content",
};
const pending: RunnerPhotoSlot = { ...ready, state: "pending", expiresAt, contentUrl: null };
const fetcher = vi.fn<typeof fetch>();
const revoke = vi.fn();
let container: HTMLDivElement;
let root: Root;
let signal: AbortSignal;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  vi.stubGlobal("fetch", fetcher.mockReset());
  class PreviewURL extends URL {
    static createObjectURL = () => "blob:race-preview";
    static revokeObjectURL = revoke.mockReset();
  }
  vi.stubGlobal("URL", PreviewURL);
  from.mockReset().mockReturnValue({ uploadToSignedUrl: upload.mockReset() });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function list(photos: RunnerPhotoSlot[]) {
  return Response.json({ photos });
}
async function render(photos: RunnerPhotoSlot[]) {
  fetcher.mockResolvedValueOnce(list(photos));
  await act(async () => root.render(createElement(RunnerPhotoManager, { runnerId: "race-a" })));
  signal = fetcher.mock.calls[0]?.[1]?.signal as AbortSignal;
}
function slots() { return [...container.querySelectorAll<HTMLElement>("main ol > li")]; }
function button(index: number, label: string) {
  const result = [...slots()[index].querySelectorAll("button")].find((b) => b.textContent === label);
  expect(result, label).toBeDefined();
  return result!;
}
function choose(index: number, file: File) {
  const input = slots()[index].querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
const jpeg = () => new File(["image"], "finish.jpg", { type: "image/jpeg" });

describe("runner photo contact sheet", () => {
  it("offers three independently labeled photo positions and lists without caching", async () => {
    await render([]);
    expect(slots()).toHaveLength(3);
    expect(fetcher.mock.calls[0]).toEqual([collection, expect.objectContaining({ cache: "no-store", signal: expect.anything() })]);
    for (const slot of slots()) {
      const input = slot.querySelector<HTMLInputElement>('input[type="file"]')!;
      expect(input.accept.split(",").sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
      expect(input.labels?.length).toBeGreaterThan(0);
    }
  });

  it.each([["image/png", 5242881], ["image/gif", 1], ["image/jpeg", 0]] as const)(
    "rejects %s of %i bytes before reserving a slot", async (type, size) => {
      await render([]);
      await act(async () => choose(0, new File([new Uint8Array(size)], "race", { type })));
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(slots()[0].querySelector("[role=alert]")?.textContent).toMatch(/JPEG|5 MiB/);
    },
  );

  it("reserves once, uploads to the signed staging path, completes, then reloads in the chosen position", async () => {
    await render([]);
    const file = jpeg();
    const transfer = deferred<{ error: null }>();
    upload.mockReturnValue(transfer.promise);
    fetcher.mockResolvedValueOnce(Response.json(capability, { status: 201 }))
      .mockResolvedValueOnce(Response.json(ready)).mockResolvedValueOnce(list([ready]));
    await act(async () => { choose(2, file); choose(2, file); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]).toEqual([collection, expect.objectContaining({
      method: "POST", body: JSON.stringify({ mimeType: "image/jpeg", sizeBytes: 5 }),
    })]);
    expect(from).toHaveBeenCalledWith("runner-photos");
    expect(upload.mock.calls).toEqual([[capability.path, capability.token, file, { contentType: file.type }]]);
    expect(slots()[2].querySelector("img")?.getAttribute("src")).toBe("blob:race-preview");
    expect(slots()[0].querySelector<HTMLInputElement>("input")?.disabled).toBe(false);

    await act(async () => transfer.resolve({ error: null }));
    expect(fetcher.mock.calls.slice(2).map(([path, init]) => [path, init?.method ?? "GET", init?.body]))
      .toEqual([[item + "/complete", "POST", "{}"], [collection, "GET", undefined]]);
    expect(slots()[2].querySelector("img")?.getAttribute("src")).toBe(item + "/content");
    expect(slots()[2].querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(container.innerHTML).not.toMatch(/upload-secret|staging\/opaque/);
    expect(revoke).toHaveBeenCalledWith("blob:race-preview");
  });

  it("restores unfinished positions with expiry, retries completion, and cancels a finalizing upload", async () => {
    const finalizing: RunnerPhotoSlot = { ...pending, id: "photo-b", state: "finalizing" };
    await render([pending, finalizing]);
    expect(slots()[0].textContent).toMatch(/pending|unfinished/i);
    expect(slots()[1].textContent).toMatch(/finalizing|finishing/i);
    expect(slots()[0].querySelector("time")?.dateTime).toBe(expiresAt);
    expect(slots()[1].querySelector("time")?.dateTime).toBe(expiresAt);
    fetcher.mockResolvedValueOnce(Response.json(ready)).mockResolvedValueOnce(list([ready, finalizing]));
    await act(async () => button(0, "Retry completion").click());
    expect(fetcher.mock.calls[1]).toEqual([item + "/complete", expect.objectContaining({ method: "POST", body: "{}" })]);
    expect(slots()[0].querySelector("img")?.getAttribute("src")).toBe(item + "/content");
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(list([ready]));
    await act(async () => button(1, "Cancel").click());
    expect(fetcher.mock.calls[3]).toEqual([collection + "/photo-b", expect.objectContaining({ method: "DELETE", body: "{}" })]);
    expect(slots()[1].querySelector('input[type="file"]')).not.toBeNull();
  });

  it("restores inclusion after a failed save, accepts zero selected, and deletes a ready photo", async () => {
    await render([ready]);
    const toggle = slots()[0].querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const saving = deferred<Response>();
    fetcher.mockReturnValueOnce(saving.promise);
    await act(async () => toggle.click());
    expect(toggle.checked).toBe(false);
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(slots()[1].querySelector<HTMLInputElement>("input")?.disabled).toBe(false);
    expect(fetcher.mock.calls[1]).toEqual([item, expect.objectContaining({ method: "PATCH", body: '{"included":false}' })]);
    fetcher.mockResolvedValueOnce(list([ready]));
    await act(async () => saving.resolve(Response.json({ error: "private/path" }, { status: 503 })));
    expect(toggle.checked).toBe(true);
    expect(slots()[0].querySelector("[role=alert]")?.textContent).toMatch(/try again/i);
    expect(container.textContent).not.toContain("private/path");
    fetcher.mockResolvedValueOnce(Response.json({ ...ready, included: false }));
    await act(async () => toggle.click());
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(false);
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(list([]));
    await act(async () => button(0, "Delete").click());
    expect(fetcher.mock.calls.some(([path, init]) => path === item && init?.method === "DELETE" && init.body === "{}")).toBe(true);
    expect(slots()[0].querySelector("img")).toBeNull();
    expect(slots()[0].querySelector('input[type="file"]')).not.toBeNull();
  });

  it("rolls back a failed PATCH, then shows the saved selection if the server committed it", async () => {
    await render([ready]);
    const toggle = slots()[0].querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const latest = deferred<Response>();
    fetcher.mockRejectedValueOnce(new TypeError("connection lost")).mockReturnValueOnce(latest.promise);
    await act(async () => toggle.click());
    expect(toggle.checked).toBe(true);
    expect(slots()[0].querySelector("[role=alert]")).not.toBeNull();
    expect(fetcher.mock.calls.at(-1)).toEqual([collection, expect.objectContaining({ method: "GET", cache: "no-store" })]);
    await act(async () => latest.resolve(list([{ ...ready, included: false }])));
    expect(toggle.checked).toBe(false);
    expect(slots()[0].querySelector("[role=alert]")).toBeNull();
  });

  it("keeps keyboard focus on the inclusion checkbox and ignores repeated activation while saving", async () => {
    await render([ready]);
    const toggle = slots()[0].querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const saving = deferred<Response>();
    fetcher.mockReturnValueOnce(saving.promise);
    toggle.focus();
    function pressSpace() {
      toggle.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
      toggle.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true }));
      // jsdom omits the native checkbox's keyboard-generated click (detail zero).
      toggle.dispatchEvent(new MouseEvent("click", { detail: 0, bubbles: true, cancelable: true }));
    }
    await act(async () => pressSpace());
    expect(document.activeElement).toBe(toggle);
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    await act(async () => pressSpace());
    expect(toggle.checked).toBe(false);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    await act(async () => saving.resolve(Response.json({ ...ready, included: false })));
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("keeps a failed staged upload recoverable without exposing the storage error", async () => {
    await render([]);
    fetcher.mockResolvedValueOnce(Response.json(capability, { status: 201 })).mockResolvedValueOnce(list([pending]));
    upload.mockResolvedValueOnce({ error: new Error("private /staging/secret") });
    await act(async () => choose(1, jpeg()));
    expect(slots()[1].querySelector("[role=alert]")?.textContent).toMatch(/cancel/i);
    expect(container.textContent).not.toContain("secret");
    expect(button(1, "Cancel").disabled).toBe(false);
    expect(revoke).toHaveBeenCalledWith("blob:race-preview");
  });

  it("keeps keyboard focus in the same slot when deleting its photo", async () => {
    await render([ready]);
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(list([]));
    const remove = button(0, "Delete");
    remove.focus();
    await act(async () => remove.click());
    expect(slots()[0].contains(document.activeElement)).toBe(true);
  });

  it("ignores a stale list while a different slot's selection is saving", async () => {
    await render([ready, { ...pending, id: "photo-b" }]);
    const staleList = deferred<Response>();
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 })).mockReturnValueOnce(staleList.promise);
    await act(async () => button(1, "Cancel").click());
    const save = deferred<Response>();
    const excluded = { ...ready, included: false };
    fetcher.mockReturnValueOnce(save.promise).mockResolvedValueOnce(list([excluded]));
    const toggle = slots()[0].querySelector<HTMLInputElement>("input")!;
    await act(async () => toggle.click());
    await act(async () => staleList.resolve(list([ready])));
    expect(toggle.checked).toBe(false);
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    await act(async () => save.resolve(Response.json(excluded)));
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(false);
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe(collection);
  });

  it("can retry a failed list without displaying service details or offering unavailable slots", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ error: "private/path" }, { status: 503 }));
    await act(async () => root.render(createElement(RunnerPhotoManager, { runnerId: "race-a" })));
    expect(container.querySelector("main [role=alert]")?.textContent).toMatch(/try again/i);
    expect(container.textContent).not.toContain("private/path");
    expect(container.querySelector("input[type=file]")).toBeNull();
    fetcher.mockResolvedValueOnce(list([{ ...ready, contentUrl: "https://example.invalid/private-object" }]));
    await act(async () => container.querySelector<HTMLButtonElement>("main button")!.click());
    expect(slots()).toHaveLength(3);
    expect(slots()[0].querySelector("img")?.getAttribute("src")).toBe(item + "/content");
  });

  it("aborts reads, releases local previews, and prevents completion after leaving the page", async () => {
    await render([]);
    fetcher.mockResolvedValueOnce(Response.json(capability, { status: 201 }));
    const transfer = deferred<{ error: null }>();
    upload.mockReturnValue(transfer.promise);
    await act(async () => choose(0, jpeg()));
    await act(async () => root.render(null));
    expect(signal.aborted).toBe(true);
    expect(revoke).toHaveBeenCalledWith("blob:race-preview");
    await act(async () => transfer.resolve({ error: null }));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
