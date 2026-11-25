import "server-only";
import { getSupabaseAdmin } from "../supabaseServer";
import { removePhotoObject } from "./storage";
import { ackCleanup, backendData, claimCleanup, failCleanup, sweepUploads, type CleanupJob } from "./store";
import { RunnerPhotoError } from "./types";

const defaultBatchSize = 10;
const leaseSeconds = 120;

async function removeClaimedJob(job: CleanupJob): Promise<boolean> {
  try {
    // The claim RPC commits its lease and enforces not_before before returning this path.
    await removePhotoObject(job.object_path);
  } catch {
    // Claims increment attempts. Read it only on failure and only for this lease.
    const row = await backendData(() => getSupabaseAdmin().from("runner_photo_cleanup")
      .select("attempts").eq("id", job.job_id).eq("lease_id", job.lease_id)
      .maybeSingle<{ attempts: number }>());
    if (row) {
      const backoffSeconds = Math.min(86400, 30 * 2 ** (row.attempts - 1));
      await failCleanup(job.job_id, job.lease_id, "storage_unavailable", backoffSeconds);
    }
    return false;
  }
  return ackCleanup(job.job_id, job.lease_id);
}

export async function processRunnerPhotoCleanup({ batchSize = defaultBatchSize }: { batchSize?: number } = {}) {
  const limit = Number.isFinite(batchSize) ? Math.max(1, Math.min(100, Math.trunc(batchSize))) : defaultBatchSize;
  const swept = await sweepUploads(new Date().toISOString());
  const jobs = await claimCleanup(limit, leaseSeconds);
  let processed = 0;
  let settlementFailed = false;
  for (const job of jobs) {
    try {
      if (await removeClaimedJob(job)) processed++;
    } catch {
      // A later claim recovers an unsettled lease, including after an ambiguous ACK.
      settlementFailed = true;
    }
  }
  if (settlementFailed) throw new RunnerPhotoError("unavailable");
  return { swept, processed };
}
