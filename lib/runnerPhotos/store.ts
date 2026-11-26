import "server-only";
import { getSupabaseAdmin } from "../supabaseServer";
import { RunnerPhotoError, type RunnerPhotoSlot, type RunnerPhotoState, type UploadDeclaration } from "./types";

export interface PhotoRow {
  id: string;
  state: RunnerPhotoState;
  included: boolean;
  created_at: string;
  reservation_expires_at: string;
  upload_expires_at: string | null;
  lease_expires_at: string | null;
  staging_object_path: string;
  input_mime_type: UploadDeclaration["mimeType"];
  input_size_bytes: number;
  ready_object_path: string | null;
  ready_size_bytes: number | null;
}

const slotColumns = "id,state,included,created_at,reservation_expires_at,upload_expires_at,lease_expires_at";
type SlotRow = Pick<PhotoRow, "id" | "state" | "included" | "created_at" | "reservation_expires_at" | "upload_expires_at" | "lease_expires_at">;

export async function backendData<T>(request: () => PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  try {
    const { data, error } = await request();
    if (!error) return data;
  } catch { /* Discard transport errors, which can contain paths or credentials. */ }
  throw new RunnerPhotoError("unavailable");
}

export async function requirePhotoOwner(userId: string, runnerId: string) {
  const owner = await backendData(() => getSupabaseAdmin().from("runner_access").select("runner_id")
    .eq("user_id", userId).eq("runner_id", runnerId).maybeSingle());
  if (!owner) throw new RunnerPhotoError("not_found");
}

export function toSlot(row: SlotRow, runnerId: string): RunnerPhotoSlot {
  const ready = row.state === "ready";
  // prepare() recovers an expired lease transactionally on the next completion.
  const expiredLease = row.state === "finalizing" && Date.parse(row.lease_expires_at!) <= Date.now();
  return {
    id: row.id, included: row.included, createdAt: row.created_at, state: expiredLease ? "pending" : row.state,
    expiresAt: ready ? null : row.upload_expires_at ?? row.reservation_expires_at,
    contentUrl: ready ? `/api/runners/${runnerId}/photos/${row.id}/content` : null,
  };
}

export async function listSlots(userId: string, runnerId: string, includedOnly: boolean) {
  const rows = await backendData(() => {
    let query = getSupabaseAdmin().from("runner_uploaded_photos").select(slotColumns)
      .eq("user_id", userId).eq("runner_id", runnerId);
    if (includedOnly) query = query.eq("state", "ready").eq("included", true);
    return query.order("created_at").order("id").returns<SlotRow[]>();
  });
  if (!rows) throw new RunnerPhotoError("unavailable");
  return rows.map(row => toSlot(row, runnerId)).filter(slot => !slot.expiresAt || Date.parse(slot.expiresAt) > Date.now());
}

export async function ownedPhoto(userId: string, runnerId: string, photoId: string, readyOnly = false): Promise<PhotoRow> {
  const row = await backendData(() => {
    let query = getSupabaseAdmin().from("runner_uploaded_photos")
      .select(slotColumns + ",staging_object_path,ready_object_path,input_mime_type,input_size_bytes,ready_size_bytes")
      .eq("user_id", userId).eq("runner_id", runnerId).eq("id", photoId);
    if (readyOnly) query = query.eq("state", "ready");
    return query.maybeSingle<PhotoRow>();
  });
  if (!row) throw new RunnerPhotoError("not_found");
  return row;
}

function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  return backendData(() => getSupabaseAdmin().rpc(name, args)) as Promise<T>;
}

export const ownerArgs = (userId: string, runnerId: string) => ({ p_user_id: userId, p_runner_id: runnerId });
export const photoArgs = (userId: string, runnerId: string, photoId: string) => ({ ...ownerArgs(userId, runnerId), p_photo_id: photoId });
type OwnerArgs = ReturnType<typeof ownerArgs>;
type PhotoArgs = ReturnType<typeof photoArgs>;

export async function reserveUpload(owner: OwnerArgs, input: UploadDeclaration, expiresAt: string) {
  const rows = await rpc<{ photo_id: string; staging_object_path: string }[]>("reserve_runner_photo_upload", {
    ...owner, p_input_mime_type: input.mimeType, p_input_size_bytes: input.sizeBytes, p_reservation_expires_at: expiresAt,
  });
  return rows[0];
}

export function activateUpload(photo: PhotoArgs, expiresAt: string) {
  return rpc<boolean>("activate_runner_photo_upload", { ...photo, p_upload_expires_at: expiresAt });
}

interface Lease { ready_object_path: string; lease_id: string; lease_expires_at: string }

export async function prepareReady(photo: PhotoArgs, expiresAt: string) {
  const rows = await rpc<Lease[]>("prepare_runner_photo_ready", { ...photo, p_lease_expires_at: expiresAt });
  return rows[0];
}

export function finalizeUpload(photo: PhotoArgs, lease: Lease, sizeBytes: number) {
  return rpc<boolean>("finalize_runner_photo_upload", {
    ...photo, p_ready_object_path: lease.ready_object_path, p_lease_id: lease.lease_id, p_ready_size_bytes: sizeBytes,
  });
}

export function setIncluded(photo: PhotoArgs, included: boolean) {
  return rpc<boolean>("set_runner_photo_included", { ...photo, p_included: included });
}

export function deletePhoto(photo: PhotoArgs) {
  return rpc<boolean>("delete_runner_photo", photo);
}

export function sweepUploads(now: string) {
  return rpc<number>("sweep_runner_photo_uploads", { p_now: now });
}

export interface CleanupJob { job_id: string; object_path: string; object_kind: "staging" | "provisional_ready" | "ready"; lease_id: string }

export function claimCleanup(limit: number, leaseSeconds: number) {
  return rpc<CleanupJob[]>("claim_runner_photo_cleanup", { p_limit: limit, p_lease_seconds: leaseSeconds });
}

export function ackCleanup(jobId: string, leaseId: string) {
  return rpc<boolean>("ack_runner_photo_cleanup", { p_job_id: jobId, p_lease_id: leaseId });
}

export function failCleanup(jobId: string, leaseId: string, errorCode: string, backoffSeconds: number) {
  return rpc<boolean>("fail_runner_photo_cleanup", {
    p_job_id: jobId, p_lease_id: leaseId, p_error_code: errorCode, p_backoff_seconds: backoffSeconds,
  });
}
