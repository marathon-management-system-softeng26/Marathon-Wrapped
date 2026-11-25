import { StorageApiError } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";
import { processRunnerPhotoCleanup } from "@/lib/runnerPhotos/cleanup";
import * as store from "@/lib/runnerPhotos/store";

vi.mock("@/lib/runnerPhotos/store", async original => ({
  ...await original<typeof store>(),
  sweepUploads: vi.fn(), claimCleanup: vi.fn(), ackCleanup: vi.fn(), failCleanup: vi.fn(),
}));
const { getBucket, remove, fromTable, select, eq, maybeSingle } = vi.hoisted(() => ({
  getBucket: vi.fn(), remove: vi.fn(), fromTable: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(),
}));
vi.mock("@/lib/supabaseServer", () => ({
  getSupabaseAdmin: () => ({ from: fromTable, storage: { getBucket, from: () => ({ remove }) } }),
}));

const first: store.CleanupJob = {
  job_id: "job-a", lease_id: "lease-a", object_kind: "staging", object_path: "staging/opaque-a/upload",
};
const second: store.CleanupJob = {
  job_id: "job-b", lease_id: "lease-b", object_kind: "ready", object_path: "ready/opaque-b/result",
};
const ok = (data: unknown) => ({ data, error: null });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(store.sweepUploads).mockResolvedValue(3);
  vi.mocked(store.claimCleanup).mockResolvedValue([]);
  vi.mocked(store.ackCleanup).mockResolvedValue(true);
  vi.mocked(store.failCleanup).mockResolvedValue(true);
  getBucket.mockResolvedValue(ok({ id: "runner-photos", name: "runner-photos", public: false,
    file_size_limit: 5242880, allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] }));
  remove.mockResolvedValue(ok([]));
  fromTable.mockReturnValue({ select });
  select.mockReturnValue({ eq });
  eq.mockReturnValue({ eq, maybeSingle });
  maybeSingle.mockResolvedValue(ok({ attempts: 1 }));
});

it("sweeps before claiming even when no cleanup is due", async () => {
  const result = await processRunnerPhotoCleanup();
  expect(result).toEqual({ swept: 3, processed: 0 });
  expect(store.sweepUploads).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d\d-/));
  expect(vi.mocked(store.sweepUploads).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(store.claimCleanup).mock.invocationCallOrder[0]);
  expect(remove).not.toHaveBeenCalled();
});

it.each([0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10000])("issues one bounded SQL claim for batch size %s", async batchSize => {
  await processRunnerPhotoCleanup({ batchSize });
  expect(store.claimCleanup).toHaveBeenCalledTimes(1);
  const [count, seconds] = vi.mocked(store.claimCleanup).mock.calls[0];
  expect(Number.isInteger(count)).toBe(true);
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(100);
  expect(seconds).toBeGreaterThanOrEqual(60);
  expect(seconds).toBeLessThanOrEqual(900);
});

it("starts Storage only after the claim returns and ACKs only after removal finishes", async () => {
  let commit!: (jobs: store.CleanupJob[]) => void;
  const claimed = new Promise<store.CleanupJob[]>(resolve => { commit = resolve; });
  vi.mocked(store.claimCleanup).mockReturnValue(claimed);
  let finish!: (response: unknown) => void;
  remove.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const processing = processRunnerPhotoCleanup({ batchSize: 2 });
  await vi.waitFor(() => expect(store.claimCleanup).toHaveBeenCalledWith(2, expect.any(Number)));
  expect(getBucket).not.toHaveBeenCalled();
  commit([first]);
  await vi.waitFor(() => expect(remove).toHaveBeenCalledWith([first.object_path]));
  expect(store.ackCleanup).not.toHaveBeenCalled();
  finish(ok([]));
  expect(await processing).toEqual({ swept: 3, processed: 1 });
  expect(store.ackCleanup).toHaveBeenCalledWith(first.job_id, first.lease_id);
});

it("waits for a due claim before accepting Storage object-not-found on a reclaimed lease", async () => {
  const reclaimed = { ...first, lease_id: "new-lease" };
  vi.mocked(store.claimCleanup).mockResolvedValueOnce([]).mockResolvedValueOnce([reclaimed]);
  remove.mockResolvedValue({ data: null, error: new StorageApiError("missing", 404, "404", "storage", "NoSuchKey") });
  await processRunnerPhotoCleanup();
  expect(remove).not.toHaveBeenCalled();
  expect(store.ackCleanup).not.toHaveBeenCalled();
  expect(await processRunnerPhotoCleanup()).toEqual({ swept: 3, processed: 1 });
  expect(store.ackCleanup).toHaveBeenCalledWith(first.job_id, reclaimed.lease_id);
});

it.each([[1, 30], [2, 60], [3, 120], [1000, 86400]])(
  "records a bounded retry after persisted attempt %i and continues with other jobs", async (attempts, delay) => {
    vi.mocked(store.claimCleanup).mockResolvedValue([first, second]);
    remove.mockResolvedValueOnce({ data: null, error: new StorageApiError("private detail", 404, "404", "storage", "NoSuchBucket") });
    maybeSingle.mockResolvedValue(ok({ attempts }));
    expect(await processRunnerPhotoCleanup()).toEqual({ swept: 3, processed: 1 });
    expect(fromTable).toHaveBeenCalledWith("runner_photo_cleanup");
    expect(select).toHaveBeenCalledWith("attempts");
    expect(eq.mock.calls).toEqual([["id", first.job_id], ["lease_id", first.lease_id]]);
    expect(store.failCleanup).toHaveBeenCalledWith(first.job_id, first.lease_id, "storage_unavailable", delay);
    expect(store.ackCleanup).toHaveBeenCalledTimes(1);
    expect(store.ackCleanup).toHaveBeenCalledWith(second.job_id, second.lease_id);
  });

it("does not count a refused stale ACK or replace another worker's lease", async () => {
  vi.mocked(store.claimCleanup).mockResolvedValue([first, second]);
  vi.mocked(store.ackCleanup).mockResolvedValueOnce(false);
  expect(await processRunnerPhotoCleanup()).toEqual({ swept: 3, processed: 1 });
  expect(store.failCleanup).not.toHaveBeenCalled();
});

it.each(["ACK", "fail", "attempt lookup"])("continues after a %s outage and reports a safe batch error", async boundary => {
  vi.mocked(store.claimCleanup).mockResolvedValue([first, second]);
  const fault = new Error("private backend detail");
  if (boundary === "ACK") vi.mocked(store.ackCleanup).mockRejectedValueOnce(fault);
  else {
    remove.mockRejectedValueOnce(fault);
    if (boundary === "fail") vi.mocked(store.failCleanup).mockRejectedValueOnce(fault);
    else maybeSingle.mockRejectedValueOnce(fault);
  }
  await expect(processRunnerPhotoCleanup()).rejects.toMatchObject({ code: "unavailable" });
  expect(store.ackCleanup).toHaveBeenCalledWith(second.job_id, second.lease_id);
});
