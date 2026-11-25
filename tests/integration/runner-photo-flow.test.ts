import { createClient, StorageApiError, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunnerPhotoSlot, RunnerPhotoUploadCapability } from "@/lib/runnerPhotos/types";

const required = ["SUPABASE_URL", "PROJECT_REF", "PUBLISHABLE_KEY", "SERVICE_ROLE_KEY", "APP_ORIGIN", "PROCESS_SECRET"] as const;
const setting = (name: string) => process.env[`RUNNER_PHOTO_TEST_${name}`]?.trim();
const missing = required.filter(name => !setting(name));
const skip = setting("DISPOSABLE") !== "1" ? "set RUNNER_PHOTO_TEST_DISPOSABLE=1 for an isolated test project" :
  missing.length ? `missing ${missing.map(name => "RUNNER_PHOTO_TEST_" + name).join(", ")}` : "";
if (skip) console.info("Skipping private runner photo integration: " + skip);

// Error objects from Auth/Storage may contain signed URLs. Report the failed fixture step only.
function checked<T>(result: { data: T; error: unknown }, step: string): NonNullable<T> {
  if (result.error || result.data == null) throw new Error("Disposable fixture failed: " + step);
  return result.data;
}
function checkWrite(result: { error: unknown }, step: string) {
  if (result.error) throw new Error("Disposable fixture failed: " + step);
}
const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
type Account = { id: string; cookie: string; client: SupabaseClient };
const bucketName = "runner-photos";

describe.skipIf(Boolean(skip))("private runner photos on an explicitly disposable project", () => {
  const run = crypto.randomUUID();
  const users: string[] = [];
  let admin: SupabaseClient;
  let guest: SupabaseClient;
  let origin: string;
  let eventId: number;
  let runner: string;
  let owner: Account;
  let organizer: Account;
  let organizerPhoto: string;
  let collection: string;

  function request(path: string, cookie = "", method = "GET", body?: unknown) {
    return fetch(origin + path, { method, headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", redirect: "error" });
  }
  async function json<T>(response: Promise<Response>, status: number): Promise<T> {
    const result = await response;
    expect(result.status).toBe(status);
    return result.json();
  }
  const slots = async () => (await json<{ photos: RunnerPhotoSlot[] }>(request(collection, owner.cookie), 200)).photos;
  const item = (id: string) => collection + "/" + id;
  const content = (id: string) => item(id) + "/content";
  const complete = (id: string) => json<RunnerPhotoSlot>(request(item(id) + "/complete", owner.cookie, "POST", {}), 200);
  async function worker() {
    const result = await fetch(origin + "/api/internal/runner-photos/process", { method: "POST", redirect: "error",
      headers: { Authorization: "Bearer " + setting("PROCESS_SECRET") } });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ swept: expect.any(Number), processed: expect.any(Number) });
  }
  async function account(role: string): Promise<Account> {
    const email = `photo-${run}-${role}@example.invalid`;
    const password = crypto.randomUUID();
    const result = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    checkWrite(result, "create " + role);
    const created = result.data;
    if (!created.user) throw new Error("Disposable account missing");
    users.push(created.user.id);
    const jar = new Map<string, string>();
    const auth = createServerClient(setting("SUPABASE_URL")!, setting("PUBLISHABLE_KEY")!, { cookies: {
      getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
      setAll: values => values.forEach(({ name, value }) => jar.set(name, value)),
    } });
    checkWrite(await auth.auth.signInWithPassword({ email, password }), "sign in " + role);
    return { id: created.user.id, client: auth, cookie: Array.from(jar, ([name, value]) => name + "=" + value).join("; ") };
  }
  async function exists(path: string) {
    const slash = path.lastIndexOf("/");
    const name = path.slice(slash + 1);
    const files = checked(await admin.storage.from(bucketName).list(path.slice(0, slash), { search: name }), "inspect object");
    return files.some(file => file.name === name);
  }
  async function cleanupJob(path: string) {
    const result = await admin.from("runner_photo_cleanup").select("object_kind,not_before").eq("object_path", path).maybeSingle();
    checkWrite(result, "inspect cleanup");
    return result.data;
  }

  beforeAll(async () => {
    const url = new URL(setting("SUPABASE_URL")!);
    const app = new URL(setting("APP_ORIGIN")!);
    const loopback = (u: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    for (const u of [url, app]) {
      if (u.href !== u.origin + "/" || !(u.protocol === "https:" || (u.protocol === "http:" && loopback(u)))) {
        throw new Error("Expected an HTTPS origin or an HTTP loopback origin");
      }
    }
    const ref = setting("PROJECT_REF");
    if (loopback(url) ? ref !== "local" : url.hostname !== ref + ".supabase.co") throw new Error("Disposable project reference mismatch");
    origin = app.origin;
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    admin = createClient(url.origin, setting("SERVICE_ROLE_KEY")!, options);
    guest = createClient(url.origin, setting("PUBLISHABLE_KEY")!, options);
    const bucket = checked(await admin.storage.getBucket(bucketName), "inspect bucket");
    expect(bucket.public).toBe(false);
    expect(bucket.file_size_limit).toBe(5242880);
    expect(bucket.allowed_mime_types?.slice().sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);

    owner = await account("owner");
    organizer = await account("organizer");
    eventId = checked(await admin.from("events").insert({ name: "Photo acceptance " + run, event_date: "2027-08-17" })
      .select("id").single(), "event").id;
    const category = checked(await admin.from("categories").insert({ event_id: eventId, name: "5K", distance_km: 5, min_age: 17 })
      .select("id").single(), "category");
    runner = checked(await admin.from("runners").insert({ category_id: category.id, name: "Photo fixture",
      bib_number: "PHOTO-" + run.slice(0, 8), date_of_birth: "1995-01-01", gender: "F", email: "runner@example.invalid",
      phone: "0", id_type: "Passport", id_number: run, jersey_size: "M" }).select("id").single(), "runner").id;
    checkWrite(await admin.from("runner_access").insert({ user_id: owner.id, runner_id: runner }), "owner");
    checkWrite(await admin.from("organizer_access").insert({ user_id: organizer.id, event_id: eventId }), "organizer");
    checkWrite(await admin.from("chip_results").insert({ runner_id: runner, start_status: "dns", finisher: false }), "official recap");
    organizerPhoto = checked(await admin.from("fotoyu_photos").insert({ runner_id: runner, photo_url: "/photos/demo-race.jpg" })
      .select("id").single(), "organizer photo").id;
    collection = "/api/runners/" + runner + "/photos";
    // Prove the app sees these exact random fixtures before invoking its project-wide cleanup worker.
    expect(await slots()).toEqual([]);
    const catalog = await json<{ events: { id: number }[]; runners: unknown[] }>(request("/api/session", organizer.cookie), 200);
    expect(catalog.events.map(e => e.id)).toContain(eventId);
    expect(catalog.runners).toEqual([]);
  }, 90_000);

  afterAll(async () => {
    const failures: string[] = [];
    if (eventId && (await admin.from("events").delete().eq("id", eventId)).error) failures.push("event");
    for (const user of users) if ((await admin.auth.admin.deleteUser(user)).error) failures.push("test user");
    expect(failures, "Fixture teardown").toEqual([]);
    // Cascades enqueue exact keys. Keep staging tombstones until signed capabilities actually expire.
  }, 60_000);

  it("recovers interruptions after reserve, sign, activate, prepare, write and finalize", async () => {
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: "blue" } }).webp().toBuffer();
    const ownerArgs = { p_user_id: owner.id, p_runner_id: runner };
    for (const stop of ["reserve", "sign", "activate", "prepare", "write", "finalize"] as const) {
      const deadline = at(180);
      const [reserved] = checked(await admin.rpc("reserve_runner_photo_upload", { ...ownerArgs, p_input_mime_type: "image/webp",
        p_input_size_bytes: image.length, p_reservation_expires_at: deadline }), "reserve");
      const args = { ...ownerArgs, p_photo_id: reserved.photo_id };
      const staging = reserved.staging_object_path;
      const bucket = admin.storage.from(bucketName);
      let signedUntil = deadline;
      if (stop !== "reserve") {
        const signed = checked(await bucket.createSignedUploadUrl(staging, { upsert: false }), "sign");
        signedUntil = new Date(JSON.parse(Buffer.from(signed.token.split(".")[1], "base64url").toString()).exp * 1000).toISOString();
        if (stop !== "sign") {
          expect(checked(await admin.rpc("activate_runner_photo_upload", { ...args, p_upload_expires_at: signedUntil }), "activate")).toBe(true);
          checkWrite(await guest.storage.from(bucketName).uploadToSignedUrl(staging, signed.token, image, { contentType: "image/webp" }), "upload");
        }
      }
      const ledger = admin.from("runner_uploaded_photos");
      if (stop === "reserve") {
        checkWrite(await ledger.update({ reservation_expires_at: at(-11) }).eq("id", reserved.photo_id), "age unsigned reservation");
        await worker();
        expect(await cleanupJob(staging)).toBeNull();
      } else if (stop === "sign" || stop === "activate") {
        // A lost sign/activation response leaves a pending slot that the runner can cancel.
        expect((await slots()).find(s => s.id === reserved.photo_id)?.state).toBe("pending");
        expect((await request(item(reserved.photo_id), owner.cookie, "DELETE", {})).status).toBe(204);
        const job = await cleanupJob(staging);
        expect(job?.object_kind).toBe("staging");
        expect(Date.parse(job!.not_before)).toBeGreaterThanOrEqual(Date.parse(signedUntil) + 600_000);
        await worker();
        expect(await cleanupJob(staging)).toEqual(job);
      } else {
        const [lease] = checked(await admin.rpc("prepare_runner_photo_ready", { ...args, p_lease_expires_at: at(5) }), "prepare");
        if (stop !== "prepare") checkWrite(await bucket.upload(lease.ready_object_path, image, { contentType: "image/webp", upsert: false }), "write");
        if (stop === "finalize") {
          expect(checked(await admin.rpc("finalize_runner_photo_upload", { ...args, p_lease_id: lease.lease_id,
            p_ready_object_path: lease.ready_object_path, p_ready_size_bytes: image.length }), "finalize")).toBe(true);
          expect((await complete(reserved.photo_id)).state).toBe("ready"); // lost success response
        } else {
          expect((await request(content(reserved.photo_id), owner.cookie)).status).toBe(404);
          checkWrite(await ledger.update({ lease_expires_at: at(-11) }).eq("id", reserved.photo_id), "age interrupted writer");
          await worker();
          expect((await slots()).find(slot => slot.id === reserved.photo_id)?.state).toBe("pending");
          expect(await exists(lease.ready_object_path)).toBe(false);
          expect(await cleanupJob(lease.ready_object_path)).toBeNull();
          expect((await complete(reserved.photo_id)).state).toBe("ready");
        }
        expect((await request(item(reserved.photo_id), owner.cookie, "DELETE", {})).status).toBe(204);
        await worker();
      }
      expect(await slots()).toEqual([]);
    }
  }, 180_000);

  it("enforces owner-only access and quota and keeps released content private", async () => {
    const images = await Promise.all(["red", "green", "blue", "yellow"].map(background =>
      sharp({ create: { width: 12, height: 9, channels: 3, background } }).png().toBuffer()));
    const attempts = await Promise.all(images.map(image => request(collection, owner.cookie, "POST", { mimeType: "image/png", sizeBytes: image.length })));
    expect(attempts.map(result => result.status).sort()).toEqual([201, 201, 201, 409]);
    const accepted: { cap: RunnerPhotoUploadCapability; image: Buffer }[] = [];
    for (const [index, result] of attempts.entries()) {
      if (result.status === 201) accepted.push({ cap: await result.json(), image: images[index] });
    }
    for (const { cap, image } of accepted) {
      expect(cap.path.startsWith("staging/")).toBe(true);
      checkWrite(await guest.storage.from(bucketName).uploadToSignedUrl(cap.path, cap.token, image, { contentType: "image/png" }), "signed fixture upload");
    }
    const pending = await slots(); // independent request after upload, before completion
    expect(pending.map(s => s.id).sort()).toEqual(accepted.map(a => a.cap.photoId).sort());
    expect(pending.every(s => s.state === "pending" && s.contentUrl === null)).toBe(true);
    for (const s of pending) expect(await complete(s.id)).toMatchObject({ id: s.id, state: "ready", included: true, contentUrl: content(s.id) });
    const ids = pending.map(s => s.id); // collection order is creation time, then ID
    const cap = accepted.find(a => a.cap.photoId === ids[0])!;
    const row = checked(await admin.from("runner_uploaded_photos").select("ready_object_path").eq("id", ids[0]).single(), "ready key");
    expect(row.ready_object_path.startsWith("ready/")).toBe(true);
    for (const path of [cap.cap.path, row.ready_object_path]) {
      expect(await exists(path)).toBe(true);
      for (const client of [guest, owner.client, organizer.client]) {
        const denied = await client.storage.from(bucketName).download(path);
        expect([400, 401, 403, 404]).toContain(denied.error?.status);
      }
      const publicUrl = guest.storage.from(bucketName).getPublicUrl(path).data.publicUrl;
      expect([400, 401, 403, 404]).toContain((await fetch(publicUrl, { cache: "no-store", redirect: "error" })).status);
    }
    for (const id of ids) {
      const response = await request(content(id), owner.cookie);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/webp");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("pragma")).toBe("no-cache");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(response.headers.get("content-length")).toBe(String(bytes.length));
      expect(await sharp(bytes).metadata()).toMatchObject({ format: "webp", width: 12, height: 9 });
      expect((await request(content(id), organizer.cookie)).status).toBe(404);
      expect((await request(content(id))).status).toBe(401);
    }
    expect(await json(request(item(ids[2]), owner.cookie, "PATCH", { included: false }), 200)).toMatchObject({ included: false });
    const wrapped = await json<{ photos: { id: string; source: string }[] }>(request("/api/runners/" + runner + "/wrapped", owner.cookie), 200);
    expect(wrapped.photos.map(p => [p.id, p.source])).toEqual([[ids[0], "personal"], [ids[1], "personal"], [organizerPhoto, "organizer"]]);

    expect((await request(item(ids[0]), owner.cookie, "DELETE", {})).status).toBe(204);
    expect((await request(content(ids[0]), owner.cookie)).status).toBe(404);
    // A retried upload uses its original staging path only. An existing staging object and upsert:false can reject the retry.
    const retry = await guest.storage.from(bucketName).uploadToSignedUrl(cap.cap.path, cap.cap.token, cap.image, { contentType: "image/png" });
    if (retry.error) {
      const conflict = retry.error instanceof StorageApiError && (retry.error.status === 409 ||
        ["Duplicate", "ResourceAlreadyExists", "KeyAlreadyExists"].includes(retry.error.code ?? ""));
      expect(conflict, "Storage refused a duplicate staging write").toBe(true);
    } else {
      expect(retry.data?.path === cap.cap.path).toBe(true);
    }
    expect(await exists(cap.cap.path)).toBe(true);
    expect((await request(content(ids[0]), owner.cookie)).status).toBe(404);
    checkWrite(await admin.from("runner_access").delete().eq("runner_id", runner).eq("user_id", owner.id), "release ownership");
    for (const id of ids) expect((await request(content(id), owner.cookie)).status).toBe(404);
    expect((await request(collection, owner.cookie)).status).toBe(404);
    await worker();
    expect(await exists(row.ready_object_path)).toBe(false);
    expect(await cleanupJob(row.ready_object_path)).toBeNull();
    expect((await cleanupJob(cap.cap.path))?.object_kind).toBe("staging");
  }, 180_000);
});
