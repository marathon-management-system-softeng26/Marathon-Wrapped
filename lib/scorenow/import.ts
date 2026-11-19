import type { ScoreNowCheckpoint, ScoreNowDataset, ScoreNowResult } from "./types";

export type ScoreNowImportRow = {
  competition_id: number;
  race_id: number;
  source_event_id: number;
  source_uid: string;
  race_name: string;
  race_date: string;
  category: "5K" | "10K";
  position: number | null;
  bib_number: string;
  runner_name: string;
  official_time: string | null;
  official_time_ms: number | null;
  source_category: string;
  category_rank: number | null;
  category_total: number | null;
  gender: string;
  gender_rank: number | null;
  gender_total: number | null;
  checkpoints: ScoreNowCheckpoint[];
  detail_url: string;
  source_url: string;
  scraped_at: string;
};

export type ScoreNowImportBatch = { rows: ScoreNowImportRow[] };

function mapRow(dataset: ScoreNowDataset, result: ScoreNowResult): ScoreNowImportRow {
  return {
    competition_id: result.competitionId,
    race_id: result.raceId,
    source_event_id: result.eventId,
    source_uid: result.sourceUid,
    race_name: dataset.raceName,
    race_date: dataset.raceDate,
    category: result.category,
    position: result.position,
    bib_number: result.bibNumber,
    runner_name: result.name,
    official_time: result.officialTime,
    official_time_ms: result.officialTimeMilliseconds,
    source_category: result.categoryName,
    category_rank: result.categoryRank,
    category_total: result.categoryTotal,
    gender: result.gender,
    gender_rank: result.genderRank,
    gender_total: result.genderTotal,
    checkpoints: result.checkpoints,
    detail_url: result.detailUrl,
    source_url: result.sourceUrl,
    scraped_at: result.scrapedAt,
  };
}

export function toScoreNowImportBatches(dataset: ScoreNowDataset, batchSize: number): ScoreNowImportBatch[] {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) throw new Error(`Invalid batch size: ${batchSize}`);

  for (const category of dataset.categories) {
    if (category.results.length !== category.declaredTotal) {
      throw new Error(`${category.category} declared total mismatch: ${category.results.length}/${category.declaredTotal}`);
    }
  }
  const results = dataset.categories.flatMap((category) => category.results);
  if (results.length !== dataset.totalResults) {
    throw new Error(`Invalid dataset total: ${results.length}/${dataset.totalResults}`);
  }

  const batches: ScoreNowImportBatch[] = [];
  for (let offset = 0; offset < results.length; offset += batchSize) {
    batches.push({ rows: results.slice(offset, offset + batchSize).map((row) => mapRow(dataset, row)) });
  }
  return batches;
}
