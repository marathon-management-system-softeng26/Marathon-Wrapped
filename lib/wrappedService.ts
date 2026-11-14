import "server-only";
import { requireRunnerAccess } from "@/lib/auth/access";
import { getRunnerChipInput, getRunnerSummary } from "@/controllers/runnerController";
import { getRunnerEnrichment } from "@/controllers/enrichmentController";
import { buildWrappedStats } from "@/lib/stats";
import { mergeWrapped } from "@/lib/merge";
import type { Enrichment, WrappedPayload } from "@/lib/wrappedPayload";

async function loadEnrichment(userId: string, runnerId: string, bib: string | null): Promise<Enrichment> {
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  const fallback: Enrichment = { strava: { state: "unavailable", metrics: null }, photos: [], warnings: ["Extra details are unavailable. Your chip recap is ready."] };
  try {
    const enrichment = getRunnerEnrichment(runnerId, bib, controller.signal, userId);
    return await Promise.race([
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
    return fallback;
  } finally {
    if (deadline) clearTimeout(deadline);
    if (grace) clearTimeout(grace);
  }
}

export async function getWrappedForUser(userId: string, runnerId: string): Promise<WrappedPayload | null> {
  await requireRunnerAccess(userId, runnerId);
  const input = await getRunnerChipInput(runnerId);
  if (!input) {
    const runner = await getRunnerSummary(runnerId);
    if (!runner) return null;
    const optional = await loadEnrichment(userId, runnerId, runner.bib_number);
    return { status: "unavailable", runner, reason: "missing_result", ...optional };
  }
  const optional = await loadEnrichment(userId, runnerId, input.bib_number);
  return mergeWrapped(buildWrappedStats(input), optional);
}
