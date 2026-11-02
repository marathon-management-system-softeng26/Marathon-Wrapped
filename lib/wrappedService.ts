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
  let grace: ReturnType<typeof setTimeout> | undefined;
  const fallback: Enrichment = { strava: { state: "unavailable", metrics: null }, photos: [], warnings: ["Extra details are unavailable. Your chip recap is ready."] };
  try {
    const enrichment = getRunnerEnrichment(runnerId, input.bib_number, controller.signal, userId);
    optional = await Promise.race([
      enrichment,
      new Promise<Enrichment>((resolve) => {
        deadline = setTimeout(() => {
          controller.abort();
          grace = setTimeout(() => resolve(fallback), 25);
          enrichment.then(
            (value) => { if (grace) clearTimeout(grace); resolve(value); },
            () => { if (grace) clearTimeout(grace); resolve(fallback); },
          );
        }, 1200);
      }),
    ]);
  } catch {
    optional = fallback;
  } finally {
    if (deadline) clearTimeout(deadline);
    if (grace) clearTimeout(grace);
  }
  return mergeWrapped(buildWrappedStats(input), optional);
}
