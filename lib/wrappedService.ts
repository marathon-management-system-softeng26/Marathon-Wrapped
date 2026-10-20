import "server-only";
import { requireRunnerAccess } from "@/lib/auth/access";
import { getRunnerChipInput, getRunnerSummary } from "@/controllers/runnerController";
import { getRunnerEnrichment } from "@/controllers/enrichmentController";
import { buildWrappedStats } from "@/lib/stats";
import { mergeWrapped } from "@/lib/merge";
import type { Enrichment, WrappedPayload } from "@/lib/wrappedPayload";

export async function getWrappedForUser(userId: string, runnerId: string): Promise<WrappedPayload | null> {
  await requireRunnerAccess(userId, runnerId);
  const input = await getRunnerChipInput(runnerId);
  if (!input) {
    const runner = await getRunnerSummary(runnerId);
    return runner ? { status: "unavailable", runner, reason: "missing_result" } : null;
  }
  let optional: Enrichment;
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    optional = await Promise.race([
      getRunnerEnrichment(runnerId, input.bib_number, controller.signal),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => {
          controller.abort();
          reject(new Error("Optional data deadline exceeded."));
        }, 1200);
      }),
    ]);
  } catch {
    optional = { strava: { state: "unavailable", metrics: null }, photos: [], warnings: ["Extra details are unavailable. Your chip recap is ready."] };
  } finally {
    if (deadline) clearTimeout(deadline);
  }
  return mergeWrapped(buildWrappedStats(input), optional);
}
