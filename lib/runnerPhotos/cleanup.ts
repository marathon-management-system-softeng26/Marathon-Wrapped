import "server-only";
import { getSupabaseAdmin } from "../supabaseServer";
import { removePhotoObject } from "./storage";
import { ackCleanup, backendData, claimCleanup, failCleanup, sweepUploads, type CleanupJob } from "./store";
import { RunnerPhotoError } from "./types";

const defaultBatchSize = 10;
const leaseSeconds = 120;
// Sweep + claim + removal + attempt lookup + retry fit within the 60-second route.
const databaseTimeoutMs = 8_000;
const removalTimeoutMs = 20_000;

async function withTimeout<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RunnerPhotoError("unavailable")), timeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function removeClaimedJob(job: CleanupJob): Promise<boolean> {
  try {
    // The claim RPC commits its lease and enforces not_before before returning this path.
    await withTimeout(removePhotoObject(job.object_path), removalTimeoutMs);
  } catch {
    // Claims increment attempts. Read it only on failure and only for this lease.
    const lookup = backendData(() => getSupabaseAdmin().from("runner_photo_cleanup")
      .select("attempts").eq("id", job.job_id).eq("lease_id", job.lease_id)
      .maybeSingle<{ attempts: number }>());
    const row = await withTimeout(lookup, databaseTimeoutMs);
    if (row) {
      const backoffSeconds = Math.min(86400, 30 * 2 ** (row.attempts - 1));
      await withTimeout(failCleanup(job.job_id, job.lease_id, "storage_unavailable", backoffSeconds), databaseTimeoutMs);
    }
    return false;
  }
  return withTimeout(ackCleanup(job.job_id, job.lease_id), databaseTimeoutMs);
}

export async function processRunnerPhotoCleanup({ batchSize = defaultBatchSize }: { batchSize?: number } = {}) {
  const limit = Number.isFinite(batchSize) ? Math.max(1, Math.min(100, Math.trunc(batchSize))) : defaultBatchSize;
  const swept = await withTimeout(sweepUploads(new Date().toISOString()), databaseTimeoutMs);
  const jobs = await withTimeout(claimCleanup(limit, leaseSeconds), databaseTimeoutMs);
  const outcomes = await Promise.allSettled(jobs.map(removeClaimedJob));
  // A later claim recovers an unsettled lease, including after an ambiguous ACK.
  if (outcomes.some(outcome => outcome.status === "rejected")) throw new RunnerPhotoError("unavailable");
  const processed = outcomes.filter(outcome => outcome.status === "fulfilled" && outcome.value).length;
  return { swept, processed };
}
