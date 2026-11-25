import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { crc32, deflateSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { parseUploadDeclaration, parsePhotoId, parseIncluded } from "@/lib/runnerPhotos/validation";
import {
  normalizeRunnerPhoto, beginRunnerPhotoUpload, completeRunnerPhotoUpload, listRunnerPhotos,
  listIncludedRunnerPhotos, readRunnerPhoto, setRunnerPhotoIncluded, deleteRunnerPhoto,
} from "@/lib/runnerPhotos/service";
import { removePhotoObject } from "@/lib/runnerPhotos/storage";
import { sweepUploads, claimCleanup, ackCleanup, failCleanup } from "@/lib/runnerPhotos/store";

const owner = "00000000-0000-4000-8000-000000000001";
const runner = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000003";
const lease = "00000000-0000-4000-8000-000000000004";
const staging = "staging/opaque/original.upload";
const ready = "ready/opaque/normalized.webp";
const max = 5242880;
const now = Date.parse("2026-09-01T12:00:00Z");
const iso = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
const declaration = { mimeType: "image/png", sizeBytes: 42 };
const invalid = { code: "invalid" };
const missing = { code: "not_found" };
const unavailable = { code: "unavailable" };

describe("photo request validation", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("accepts %s at both byte bounds", mimeType => {
    for (const sizeBytes of [1, max]) {
      expect(parseUploadDeclaration({ mimeType, sizeBytes })).toEqual({ mimeType, sizeBytes });
    }
  });
  it.each([null, [], {}, { ...declaration, extra: 1 }, { ...declaration, mimeType: "image/gif" },
    ...[0, -1, 1.5, max + 1, "12", NaN].map(sizeBytes => ({ ...declaration, sizeBytes }))])(
    "refuses malformed declaration %#", input => expect(() => parseUploadDeclaration(input)).toThrow("Invalid photo input."));
  it("validates UUID and boolean without coercion", () => {
    expect(parsePhotoId(id)).toBe(id);
    expect(parseIncluded(false)).toBe(false);
    for (const value of [null, [], "private/path"]) expect(() => parsePhotoId(value)).toThrow("Invalid photo input.");
    for (const value of [null, 1, "false"]) expect(() => parseIncluded(value)).toThrow("Invalid photo input.");
  });
});

const image = (width = 24, height = 12) => sharp({ create: { width, height, channels: 3, background: "navy" } });

function pngChunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}

describe("real image decoding", () => {
  it.each(["jpeg", "png", "webp"] as const)("normalizes %s without enlargement", async format => {
    const output = await normalizeRunnerPhoto(await image().toFormat(format).toBuffer());
    expect(output).toMatchObject({ sizeBytes: output.bytes.length, mimeType: "image/webp" });
    expect(await sharp(output.bytes).metadata()).toMatchObject({ format: "webp", width: 24, height: 12 });
  });
  it("honors EXIF orientation, strips metadata and constrains long edges", async () => {
    const input = await image(6000, 600).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const meta = await sharp((await normalizeRunnerPhoto(input)).bytes).metadata();
    expect(meta).toMatchObject({ width: 410, height: 4096 });
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });
  it("rejects empty, oversized, malformed, unsupported and pixel-excessive files", async () => {
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(max + 1), Buffer.from("broken"),
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'/>"),
      await image(4097, 4096).png().toBuffer(), (await image().jpeg().toBuffer()).subarray(0, 130)]) {
      await expect(normalizeRunnerPhoto(bytes)).rejects.toMatchObject(invalid);
    }
  });
  it.each(["jpeg", "png", "webp"] as const)("rejects appended payloads in %s", async format => {
    const original = await image().toFormat(format).toBuffer();
    const polyglot = Buffer.concat([original, Buffer.from("<html>extra</html>"), original]);
    await expect(normalizeRunnerPhoto(polyglot)).rejects.toMatchObject(invalid);
  });
  it("rejects bytes appended inside a forged WebP container length", async () => {
    const original = await image().webp().toBuffer();
    const polyglot = Buffer.concat([original, Buffer.from("<html>trailing payload</html>")]);
    polyglot.writeUInt32LE(polyglot.length - 8, 4);
    await expect(normalizeRunnerPhoto(polyglot)).rejects.toMatchObject(invalid);
  });
  it("rejects a one-frame animated WebP", async () => {
    // A 1 × 1 WebP with an ANIM container and a single 200 ms ANMF frame.
    const animated = Buffer.from(
      "UklGRlQAAABXRUJQVlA4WAoAAAACAAAAAAAAAAAAQU5JTQYAAAD/////AABBTk1GKAAAAAAAAAAAAAAAAAAAAMgAAAJWUDhMEAAAAC8AAAAABxAlK1n/AxHR/wA=",
      "base64",
    );
    expect(await sharp(animated).metadata()).toMatchObject({ format: "webp", pages: 1, loop: 0, delay: [200] });
    await expect(normalizeRunnerPhoto(animated)).rejects.toMatchObject(invalid);
  });
  it("rejects multiframe WebP and APNG", async () => {
    const frames = randomBytes(8 * 4 * 3);
    const animated = await sharp(frames, { raw: { width: 4, height: 8, channels: 3, pageHeight: 4 } }).webp().toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    const png = await image().png().toBuffer();
    const control = Buffer.alloc(8);
    control.writeUInt32BE(2);
    const apng = Buffer.concat([png.subarray(0, 33), pngChunk("acTL", control), png.subarray(33)]);
    for (const bytes of [animated, apng]) await expect(normalizeRunnerPhoto(bytes)).rejects.toMatchObject(invalid);
  });
  it("refuses a small one-bit PNG whose normalized output exceeds 5 MiB", async () => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(4096, 0);
    ihdr.writeUInt32BE(4096, 4);
    ihdr[8] = 1;
    const scanlines = randomBytes(513 * 4096);
    for (let i = 0; i < scanlines.length; i += 513) scanlines[i] = 0;
    const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), pngChunk("IHDR", ihdr),
      pngChunk("IDAT", deflateSync(scanlines)), pngChunk("IEND", Buffer.alloc(0))]);
    expect(png.length).toBeLessThan(max);
    await expect(normalizeRunnerPhoto(png)).rejects.toMatchObject(invalid);
  }, 20_000);
});

function network() {
  const row = {
    id, user_id: owner, runner_id: runner, included: true, state: "pending", created_at: iso(0),
    input_size_bytes: 0, input_mime_type: "image/png", staging_object_path: staging,
    ready_object_path: null as string | null, ready_size_bytes: null as number | null,
    lease_expires_at: null as string | null, upload_expires_at: iso(120), reservation_expires_at: iso(180),
  };
  const token = "header." + Buffer.from(JSON.stringify({ exp: now / 1000 + 7200 })).toString("base64url") + ".signature";
  const state = {
    owned: true, present: true, row, full: false, staged: Buffer.alloc(0) as Buffer,
    stored: Buffer.alloc(0) as Buffer, infoMime: "image/png", infoSize: undefined as number | undefined,
    bucket: { id: "runner-photos", name: "runner-photos", public: false, file_size_limit: max,
      allowed_mime_types: ["image/webp", "image/png", "image/jpeg"] },
    failAt: "", refuse: "", competing: false, removeCode: "", token, calls: [] as string[],
    args: {} as Record<string, Record<string, unknown>>,
  };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const fail = () => json({ message: "private-path-secret-token", code: "unknown" }, 400);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const path = decodeURIComponent(url.pathname);
    const endpoint = path.split("/").pop()!;
    const rpc = path.includes("/rpc/");
    const action = rpc ? endpoint : path.includes("/bucket/") ? "bucket"
      : path.includes("/upload/sign/") ? "sign" : path.includes("/object/info/") ? "info"
      : path.includes("/object/") ? method === "DELETE" ? "remove" : method === "POST" ? "write" : "download"
      : endpoint;
    state.calls.push(action);
    if (action === state.failAt) return fail();
    if (action === "remove" && state.removeCode) return json({ code: state.removeCode, message: "private-path-secret-token" }, 404);
    if (rpc) {
      const args = JSON.parse(String(init?.body));
      state.args[action] = args;
      if (action === "reserve_runner_photo_upload") return json(state.full ? [] : [{ photo_id: id, staging_object_path: staging }]);
      if (action === "prepare_runner_photo_ready") {
        row.state = "finalizing";
        row.lease_expires_at = iso(10);
        row.ready_object_path = ready;
        return json(state.competing ? [] : [{ ready_object_path: ready, lease_id: lease, lease_expires_at: iso(10) }]);
      }
      if (action === state.refuse) return json(false);
      if (action === "finalize_runner_photo_upload") {
        row.state = "ready";
        row.ready_size_bytes = state.stored.length;
        row.lease_expires_at = null;
      }
      if (action === "set_runner_photo_included") row.included = args.p_included;
      if (action === "delete_runner_photo") state.present = false;
      if (action === "sweep_runner_photo_uploads") return json(2);
      if (action === "claim_runner_photo_cleanup") return json([{ job_id: id, object_path: staging, object_kind: "staging", lease_id: lease }]);
      return json(true);
    }
    if (action === "runner_access" || action === "runner_uploaded_photos") {
      expect(url.searchParams.get("user_id")).toBe("eq." + owner);
      expect(url.searchParams.get("runner_id")).toBe("eq." + runner);
      const single = action === "runner_access" || url.searchParams.has("id");
      if (url.searchParams.has("id")) expect(url.searchParams.get("id")).toBe("eq." + id);
      const visible = state.owned && (action === "runner_access" || state.present &&
        (!url.searchParams.has("state") || url.searchParams.get("state") === "eq." + row.state) &&
        (!url.searchParams.has("included") || url.searchParams.get("included") === "eq." + row.included));
      const data = action === "runner_access" ? { runner_id: runner } : row;
      // maybeSingle() can use a singular Accept header or unwrap a one-row array.
      const singular = new Headers(init?.headers).get("accept")?.includes("vnd.pgrst.object");
      return json(single && singular ? visible ? data : null : visible ? [data] : []);
    }
    if (action === "bucket") return json(state.bucket);
    if (action === "sign") {
      expect(new Headers(init?.headers).get("x-upsert")).not.toBe("true");
      vi.setSystemTime(now + 60_000);
      return json({ url: "/object/upload/sign/runner-photos/" + staging + "?token=" + state.token });
    }
    if (action === "info") return json({ size: state.infoSize ?? state.staged.length, content_type: state.infoMime });
    if (action === "download") return new Response(new Uint8Array(path.endsWith(staging) ? state.staged : state.stored));
    if (action === "write") {
      expect(path.endsWith(ready)).toBe(true);
      expect(new Headers(init?.headers).get("x-upsert")).toBe("false");
      expect(new Headers(init?.headers).get("content-type")).toBe("image/webp");
      state.stored = Buffer.from(init?.body as Uint8Array);
      return json({ Id: id, Key: ready });
    }
    if (action === "remove") return json([]);
    throw new Error("Unexpected mocked endpoint");
  }));
  return state;
}

describe("private photo service", () => {
  let net: ReturnType<typeof network>;
  beforeEach(async () => {
    vi.stubEnv("SUPABASE_URL", "https://photos.test");
    vi.stubEnv("SUPABASE_SECRET_KEY", "server-test-key");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    net = network();
    net.staged = await image().png().toBuffer();
    net.row.input_size_bytes = net.staged.length;
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const begin = () => beginRunnerPhotoUpload(owner, runner, declaration);
  const complete = () => completeRunnerPhotoUpload(owner, runner, id);
  const read = () => readRunnerPhoto(owner, runner, id);
  it("reserves then signs then activates from actual mint time", async () => {
    await expect(begin()).resolves.toEqual({ photoId: id, path: staging, token: net.token, expiresAt: iso(120) });
    expect(net.args.reserve_runner_photo_upload).toEqual({ p_user_id: owner, p_runner_id: runner,
      p_input_size_bytes: 42, p_input_mime_type: "image/png", p_reservation_expires_at: iso(180) });
    expect(net.args.activate_runner_photo_upload.p_upload_expires_at).toBe(iso(120));
    expect(net.calls.filter(c => c === "sign" || c.endsWith("_upload"))).toEqual([
      "reserve_runner_photo_upload", "sign", "activate_runner_photo_upload"]);
  });
  it.each(["opaque-token", "header.invalid.signature", "header.e30.signature"])(
    "cancels before activation when Storage returns an unreadable expiry %#", async token => {
      net.token = token;
      await expect(begin()).rejects.toMatchObject(unavailable);
      expect(net.args.delete_runner_photo).toEqual({ p_user_id: owner, p_runner_id: runner, p_photo_id: id });
      expect(net.calls).not.toContain("activate_runner_photo_upload");
      expect(net.calls).not.toContain("remove");
    });
  it.each(["sign", "activate_runner_photo_upload"])("cancels through the durable trigger on %s failure", async boundary => {
    net.failAt = boundary;
    await expect(begin()).rejects.toMatchObject(unavailable);
    expect(net.calls).toContain("delete_runner_photo");
    expect(net.calls).not.toContain("remove");
  });
  it("cancels a refused activation and distinguishes a full owner's quota", async () => {
    net.refuse = "activate_runner_photo_upload";
    await expect(begin()).rejects.toMatchObject(missing);
    expect(net.calls).toContain("delete_runner_photo");
    net.full = true;
    await expect(begin()).rejects.toMatchObject({ code: "quota" });
  });
  it("checks direct ownership before each read, and exposes only safe slots", async () => {
    expect(await listRunnerPhotos(owner, runner)).toEqual([{ id, included: true, createdAt: iso(0), state: "pending", contentUrl: null, expiresAt: iso(120) }]);
    expect(await listIncludedRunnerPhotos(owner, runner)).toEqual([]);
    await expect(read()).rejects.toMatchObject(missing);
    const slot = await complete();
    expect(slot).toEqual({ id, included: true, state: "ready", createdAt: iso(0), expiresAt: null,
      contentUrl: "/api/runners/" + runner + "/photos/" + id + "/content" });
    expect(await listIncludedRunnerPhotos(owner, runner)).toEqual([slot]);
    expect(Buffer.from(await read())).toEqual(net.stored);
    expect(net.args.finalize_runner_photo_upload).toEqual({ p_user_id: owner, p_runner_id: runner, p_photo_id: id,
      p_ready_object_path: ready, p_lease_id: lease, p_ready_size_bytes: net.stored.length });
    const preparedUntil = Date.parse(String(net.args.prepare_runner_photo_ready.p_lease_expires_at));
    expect(preparedUntil).toBeGreaterThan(now);
    expect(preparedUntil).toBeLessThanOrEqual(now + 15 * 60_000);
    expect(await complete()).toEqual(slot);
    expect(net.calls.filter(c => c === "write")).toHaveLength(1);
    expect((await setRunnerPhotoIncluded(owner, runner, id, false)).included).toBe(false);
    expect(await listIncludedRunnerPhotos(owner, runner)).toEqual([]);
    net.owned = false;
    await expect(read()).rejects.toMatchObject(missing);
    net.owned = true;
    await deleteRunnerPhoto(owner, runner, id);
    await expect(read()).rejects.toMatchObject(missing);
    expect(net.calls).not.toContain("remove");
  });
  it("denies all operations for an organizer without direct access", async () => {
    net.owned = false;
    for (const op of [begin, complete, read, () => listRunnerPhotos(owner, runner),
      () => listIncludedRunnerPhotos(owner, runner), () => setRunnerPhotoIncluded(owner, runner, id, true),
      () => deleteRunnerPhoto(owner, runner, id)]) await expect(op()).rejects.toMatchObject(missing);
    expect(net.calls).not.toContain("sign");
    expect(net.calls).not.toContain("download");
  });
  it.each(["public", "mime", "bytes", "absent"])("fails closed for %s bucket", async failure => {
    if (failure === "public") net.bucket.public = true;
    if (failure === "mime") net.bucket.allowed_mime_types.push("image/gif");
    if (failure === "bytes") net.bucket.file_size_limit++;
    if (failure === "absent") net.failAt = "bucket";
    await expect(begin()).rejects.toMatchObject(unavailable);
    expect(net.calls).not.toContain("sign");
  });
  it.each(["info MIME", "info size", "actual MIME", "stream length", "oversized stream"])("rejects %s mismatch before preparing a path", async failure => {
    if (failure === "info MIME") net.infoMime = "image/webp";
    if (failure === "info size") net.infoSize = 0;
    if (failure === "actual MIME") net.row.input_mime_type = net.infoMime = "image/jpeg";
    if (failure === "stream length" || failure === "oversized stream") {
      net.infoSize = net.row.input_size_bytes;
      net.staged = Buffer.alloc(failure === "stream length" ? 1 : max + 1);
    }
    await expect(complete()).rejects.toMatchObject(invalid);
    expect(net.calls).not.toContain("prepare_runner_photo_ready");
  });
  it.each(["write", "finalize_runner_photo_upload"])("leaves persisted paths recoverable on %s failure", async boundary => {
    net.failAt = boundary;
    await expect(complete()).rejects.toMatchObject(unavailable);
    expect(net.calls.indexOf("prepare_runner_photo_ready")).toBeLessThan(net.calls.indexOf("write"));
    expect(net.row.state).toBe("finalizing");
    expect(net.calls).not.toContain("remove");
    expect(net.calls).not.toContain("delete_runner_photo");
  });
  it("rejects a stale writer whose fenced finalize is refused", async () => {
    net.refuse = "finalize_runner_photo_upload";
    await expect(complete()).rejects.toMatchObject(missing);
    expect(net.calls).not.toContain("remove");
  });
  it("does not write if another completion already won the prepare race", async () => {
    net.competing = true;
    await expect(complete()).rejects.toMatchObject({ code: "in_progress" });
    await expect(complete()).rejects.toMatchObject({ code: "in_progress" });
    expect(net.calls).not.toContain("write");
  });
  it("retries after lease expiry using a newly prepared path", async () => {
    Object.assign(net.row, { state: "finalizing", ready_object_path: "ready/old.webp", lease_expires_at: iso(-1) });
    expect((await complete()).state).toBe("ready");
    expect(net.args.finalize_runner_photo_upload.p_ready_object_path).toBe(ready);
  });
  it("omits expired slots and refuses completion", async () => {
    net.row.upload_expires_at = iso(-1);
    expect(await listRunnerPhotos(owner, runner)).toEqual([]);
    await expect(complete()).rejects.toMatchObject(missing);
    expect(net.calls).not.toContain("download");
  });
  it("accepts a missing claimed object but keeps bucket/transport failures retryable", async () => {
    net.removeCode = "NoSuchKey";
    await expect(removePhotoObject(staging)).resolves.toBeUndefined();
    net.removeCode = "NoSuchBucket";
    await expect(removePhotoObject(staging)).rejects.toMatchObject(unavailable);
  });
  it("wraps cleanup RPCs and removes one claimed object", async () => {
    expect(await sweepUploads(iso(0))).toBe(2);
    expect(await claimCleanup(3, 120)).toEqual([{ job_id: id, object_path: staging, object_kind: "staging", lease_id: lease }]);
    await removePhotoObject(staging);
    expect(await ackCleanup(id, lease)).toBe(true);
    expect(await failCleanup(id, lease, "storage_error", 60)).toBe(true);
    expect(net.args.fail_runner_photo_cleanup).toEqual({ p_job_id: id, p_lease_id: lease, p_error_code: "storage_error", p_backoff_seconds: 60 });
  });
});
