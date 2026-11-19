import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { importScoreNowBatches } from "../lib/scorenow/import.ts";
import type { ScoreNowDataset, ScoreNowResult } from "../lib/scorenow/types.ts";

const projectRef = "anbnuegocddoowagqmxw";
const configuredRef = process.env.SUPABASE_DEMO_PROJECT_REF;
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (configuredRef !== projectRef || !supabaseUrl || new URL(supabaseUrl).hostname !== `${projectRef}.supabase.co`) {
  throw new Error(`Refusing ScoreNow import: configure the dedicated ${projectRef} project explicitly.`);
}
if (!serviceKey) throw new Error("Refusing ScoreNow import: a server-only Supabase key is required.");

const artifact = resolve(".data/scorenow/soekarno-run-2026.json");
const dataset = JSON.parse(await readFile(artifact, "utf8")) as ScoreNowDataset;
const result = await importScoreNowBatches(dataset, 125, async (rows) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/import_scorenow_results`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_rows: rows satisfies Array<Record<string, unknown> | ScoreNowResult> }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`ScoreNow import RPC failed with HTTP ${response.status}.`);
  const affected = await response.json();
  if (!Number.isSafeInteger(affected)) throw new Error("ScoreNow import RPC returned an invalid acknowledgement.");
  return affected as number;
});

console.log(`Imported ${result.rows} validated ScoreNow rows in ${result.batches} acknowledged batches.`);
