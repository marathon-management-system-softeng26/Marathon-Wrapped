import { beforeEach, expect, it, vi } from "vitest";
import { AuthenticationError, requireUser } from "@/lib/auth/session";
import * as store from "@/lib/runnerPhotos/store";
import * as storage from "@/lib/runnerPhotos/storage";
import { RunnerPhotoError } from "@/lib/runnerPhotos/types";
import * as collectionRoute from "@/app/api/runners/[runnerId]/photos/route";
import * as itemRoute from "@/app/api/runners/[runnerId]/photos/[photoId]/route";
import * as completeRoute from "@/app/api/runners/[runnerId]/photos/[photoId]/complete/route";
import * as contentRoute from "@/app/api/runners/[runnerId]/photos/[photoId]/content/route";

const { GET: list, POST: begin } = collectionRoute;
const { PATCH: toggle, DELETE: remove } = itemRoute;
const { POST: complete } = completeRoute;
const { GET: content } = contentRoute;

vi.mock("@/lib/auth/session", async original => ({
  ...await original<typeof import("@/lib/auth/session")>(), requireUser: vi.fn(),
}));
vi.mock("@/lib/runnerPhotos/storage");
vi.mock("@/lib/runnerPhotos/store", async original => ({
  ...await original<typeof store>(), requirePhotoOwner: vi.fn(), ownedPhoto: vi.fn(), listSlots: vi.fn(),
  reserveUpload: vi.fn(), activateUpload: vi.fn(), setIncluded: vi.fn(), deletePhoto: vi.fn(),
}));

const origin = "https://race.example";
const userId = "00000000-0000-4000-8000-000000000001";
const runnerId = "00000000-0000-4000-8000-000000000002";
const photoId = "00000000-0000-4000-8000-000000000003";
const expiresAt = "2099-01-01T00:00:00Z";
const row: store.PhotoRow = {
  id: photoId, state: "ready", included: false, created_at: "2025-01-01T00:00:00Z",
  reservation_expires_at: expiresAt, upload_expires_at: expiresAt, lease_expires_at: expiresAt,
  staging_object_path: "staging/private", ready_object_path: "ready/private",
  ready_size_bytes: 3, input_mime_type: "image/jpeg", input_size_bytes: 100,
};
const ctx = { params: Promise.resolve({ runnerId, photoId }) };
const request = (method = "GET", body?: string, requestOrigin = origin) =>
  new Request(origin + "/api/runners/" + runnerId + "/photos", { method, body, headers: { origin: requestOrigin } });
const declaration = JSON.stringify({ mimeType: "image/jpeg", sizeBytes: 100 });

function status(response: Response, code: number) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.status).toBe(code);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireUser).mockResolvedValue({ id: userId, email: null, emailConfirmedAt: null });
  vi.mocked(store.ownedPhoto).mockResolvedValue(row);
  vi.mocked(storage.removePhotoObject).mockResolvedValue();
});

const writes = [
  { name: "begin", call: begin, method: "POST", body: declaration },
  { name: "complete", call: complete, method: "POST", body: "{}" },
  { name: "toggle", call: toggle, method: "PATCH", body: '{"included":false}' },
  { name: "delete", call: remove, method: "DELETE", body: "{}" },
];
it.each([...writes, { name: "list", method: "GET", call: list, body: undefined },
  { name: "content", method: "GET", call: content, body: undefined }])("requires a session for $name", async endpoint => {
  vi.mocked(requireUser).mockRejectedValue(new AuthenticationError());
  status(await endpoint.call(request(endpoint.method, endpoint.body), ctx), 401);
  expect(store.requirePhotoOwner).not.toHaveBeenCalled();
});

it.each(writes)("requires exact origin and bounded JSON before $name", async endpoint => {
  for (const value of ["", "http://race.example", "https://other.example"]) {
    status(await endpoint.call(request(endpoint.method, endpoint.body, value), ctx), 403);
  }
  for (const value of ["{", " ".repeat(1025) + endpoint.body]) {
    status(await endpoint.call(request(endpoint.method, value), ctx), 400);
  }
  expect(store.requirePhotoOwner).not.toHaveBeenCalled();
});

it("rejects malformed identifiers before ownership or storage access", async () => {
  for (const params of [{ runnerId: "broken", photoId }, { runnerId, photoId: "broken" }]) {
    status(await content(request(), { params: Promise.resolve(params) }), 400);
  }
  expect(store.requirePhotoOwner).not.toHaveBeenCalled();
  expect(storage.privatePhotoBucket).not.toHaveBeenCalled();
});

it("validates upload declarations and inclusion booleans", async () => {
  for (const input of [{ mimeType: "image/gif", sizeBytes: 1 }, { mimeType: "image/png", sizeBytes: 5242881 }]) {
    status(await begin(request("POST", JSON.stringify(input)), ctx), 400);
  }
  for (const body of ['{"included":"false"}', '{"included":true,"userId":"another"}']) {
    status(await toggle(request("PATCH", body), ctx), 400);
  }
  expect(store.requirePhotoOwner).not.toHaveBeenCalled();
});

it("returns three upload capabilities and a conflict when concurrent reservations exhaust the quota", async () => {
  const reservation = { photo_id: photoId, staging_object_path: row.staging_object_path };
  vi.mocked(store.reserveUpload).mockResolvedValueOnce(reservation).mockResolvedValueOnce(reservation)
    .mockResolvedValueOnce(reservation);
  vi.mocked(storage.signStaging).mockResolvedValue({ token: "upload-capability", expiresAt });
  vi.mocked(store.activateUpload).mockResolvedValue(true);
  const results = await Promise.all(Array.from({ length: 4 }, () => begin(request("POST", declaration), ctx)));
  expect(results.map(result => result.status).sort()).toEqual([201, 201, 201, 409]);
  for (const result of results) {
    status(result, result.status);
    if (result.status === 201) expect(await result.json()).toEqual({
      photoId, path: "staging/private", token: "upload-capability", expiresAt,
    });
  }
});

it("lists retryable slots without exposing object paths or upload capabilities", async () => {
  const slots = (["pending", "finalizing"] as const).map(state => store.toSlot({ ...row, state }, runnerId));
  vi.mocked(store.listSlots).mockResolvedValue(slots);
  const response = await list(request(), ctx);
  status(response, 200);
  const { photos } = await response.json();
  expect(photos).toEqual(["pending", "finalizing"].map(state => ({
    id: photoId, state, included: false, createdAt: row.created_at, expiresAt, contentUrl: null,
  })));
  expect(store.listSlots).toHaveBeenCalledWith(userId, runnerId, false);
});

it("completes idempotently, reports a live lease, toggles inclusion and deletes by exact tuple", async () => {
  const done = await complete(request("POST", "{}"), ctx);
  status(done, 200);
  expect(await done.json()).toMatchObject({ id: photoId, state: "ready" });
  vi.mocked(store.ownedPhoto).mockResolvedValueOnce({ ...row, state: "finalizing" });
  status(await complete(request("POST", "{}"), ctx), 409);
  vi.mocked(store.setIncluded).mockResolvedValue(true);
  const updated = await toggle(request("PATCH", '{"included":false}'), ctx);
  status(updated, 200);
  expect(await updated.json()).toMatchObject({ included: false });
  const tuple = { p_user_id: userId, p_runner_id: runnerId, p_photo_id: photoId };
  expect(store.setIncluded).toHaveBeenCalledWith(tuple, false);
  vi.mocked(store.deletePhoto).mockResolvedValue(true);
  status(await remove(request("DELETE", "{}"), ctx), 204);
  expect(store.deletePhoto).toHaveBeenCalledWith(tuple);
});

it("serves the exact WebP byte view with private headers and rechecks ownership and readiness", async () => {
  const bytes = Buffer.from([9, 1, 2, 3, 9]).subarray(1, 4);
  vi.mocked(storage.downloadReady).mockResolvedValue(bytes);
  const response = await content(request(), ctx);
  status(response, 200);
  expect(response.headers.get("content-type")).toBe("image/webp");
  expect(response.headers.get("content-length")).toBe("3");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  expect(store.requirePhotoOwner).toHaveBeenCalledWith(userId, runnerId);
  expect(store.ownedPhoto).toHaveBeenCalledWith(userId, runnerId, photoId, true);
});

it("keeps deletion successful when the best-effort ready-object removal is unavailable", async () => {
  vi.mocked(store.deletePhoto).mockResolvedValue(true);
  vi.mocked(storage.removePhotoObject).mockRejectedValue(new Error("private storage detail"));
  status(await remove(request("DELETE", "{}"), ctx), 204);
  expect(storage.removePhotoObject).toHaveBeenCalledWith(row.ready_object_path);
});

it("revokes the same content URL for another user, after a successful deletion and after release", async () => {
  const itemUrl = origin + "/api/runners/" + runnerId + "/photos/" + photoId;
  const getContent = () => content(new Request(itemUrl + "/content"), ctx);
  const directOwners = new Set([userId + "/" + runnerId]);
  const rows = new Map([[userId + "/" + runnerId + "/" + photoId, row]]);
  vi.mocked(store.requirePhotoOwner).mockImplementation(async (user, runner) => {
    if (!directOwners.has(user + "/" + runner)) throw new RunnerPhotoError("not_found");
  });
  vi.mocked(store.ownedPhoto).mockImplementation(async (user, runner, photo, readyOnly) => {
    const result = rows.get([user, runner, photo].join("/"));
    if (!result || (readyOnly && result.state !== "ready")) throw new RunnerPhotoError("not_found");
    return result;
  });
  vi.mocked(store.deletePhoto).mockImplementation(async args =>
    rows.delete([args.p_user_id, args.p_runner_id, args.p_photo_id].join("/")));
  vi.mocked(storage.downloadReady).mockResolvedValue(Buffer.from([1, 2, 3]));
  status(await getContent(), 200);
  vi.mocked(requireUser).mockResolvedValueOnce({
    id: "00000000-0000-4000-8000-000000000004", email: null, emailConfirmedAt: null,
  });
  const foreign = await getContent();
  status(await remove(new Request(itemUrl, { method: "DELETE", headers: { origin }, body: "{}" }), ctx), 204);
  const deleted = await getContent();
  directOwners.clear();
  const released = await getContent();
  for (const result of [foreign, deleted, released]) {
    status(result, 404);
    expect(await result.text()).toBe('{"error":"Photo not found."}');
  }
  expect(storage.downloadReady).toHaveBeenCalledTimes(1);
});

it.each([2, 4])("reports a generic private 503 when Storage returns %i bytes for a three-byte ready photo", async length => {
  const realStorage = await vi.importActual<typeof storage>("@/lib/runnerPhotos/storage");
  vi.mocked(storage.downloadReady).mockImplementation(realStorage.downloadReady);
  const stream = new Blob([new Uint8Array(length)]).stream();
  const bucket = { download: () => ({ asStream: async () => ({ data: stream, error: null }) }) };
  vi.mocked(storage.privatePhotoBucket).mockResolvedValue(bucket as unknown as Awaited<ReturnType<typeof storage.privatePhotoBucket>>);
  const response = await content(request(), ctx);
  status(response, 503);
  expect(await response.json()).toEqual({ error: "Photo service unavailable." });
});

it.each([
  { route: collectionRoute, allow: "GET, HEAD, OPTIONS, POST", unsupported: collectionRoute.DELETE },
  { route: itemRoute, allow: "DELETE, OPTIONS, PATCH", unsupported: itemRoute.HEAD },
  { route: completeRoute, allow: "OPTIONS, POST", unsupported: completeRoute.GET },
  { route: contentRoute, allow: "GET, HEAD, OPTIONS", unsupported: contentRoute.POST },
] as const)("preserves private method responses for $allow", async ({ route, allow, unsupported }) => {
  const options = route.OPTIONS();
  status(options, 204);
  expect(options.headers.get("allow")).toBe(allow);
  const result = unsupported();
  status(result, 405);
  expect(result.headers.get("allow")).toBe(allow);
  expect(store.requirePhotoOwner).not.toHaveBeenCalled();
});

it("hides internal error messages from both authentication and photo backends", async () => {
  const secret = new Error("Storage ready/private token=secret SELECT * FROM runner_access");
  vi.mocked(requireUser).mockRejectedValueOnce(secret);
  vi.mocked(storage.downloadReady).mockRejectedValueOnce(secret);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await content(request(), ctx);
    status(response, 503);
    expect(await response.json()).toEqual({ error: "Photo service unavailable." });
  }
});
