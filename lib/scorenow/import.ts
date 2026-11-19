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
  result_status: ScoreNowResult["status"];
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
    result_status: result.status,
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

  const expectedCategories = [
    { eventId: 1, category: "10K" },
    { eventId: 2, category: "5K" },
  ] as const;
  if (dataset.competitionId !== 19723 || dataset.raceId !== 308 || dataset.categories.length !== expectedCategories.length) {
    throw new Error("Invalid dataset provenance");
  }
  const seenUids = new Set<string>();
  const seenPositions = new Set<string>();
  for (let categoryIndex = 0; categoryIndex < dataset.categories.length; categoryIndex += 1) {
    const category = dataset.categories[categoryIndex];
    const expected = expectedCategories[categoryIndex];
    if (category.eventId !== expected.eventId || category.category !== expected.category) throw new Error("Invalid category provenance");
    if (category.results.length !== category.declaredTotal) {
      throw new Error(`${category.category} declared total mismatch: ${category.results.length}/${category.declaredTotal}`);
    }
    for (const row of category.results) {
      if (seenUids.has(row.sourceUid)) throw new Error(`Duplicate source UID: ${row.sourceUid}`);
      seenUids.add(row.sourceUid);
      if (
        row.competitionId !== dataset.competitionId ||
        row.raceId !== dataset.raceId ||
        row.eventId !== category.eventId ||
        row.category !== category.category ||
        !row.sourceUid.startsWith(`${dataset.competitionId}-${dataset.raceId}-${category.eventId}-`)
      ) {
        throw new Error(`Invalid result provenance: ${row.sourceUid}`);
      }
      if (!row.bibNumber.trim()) throw new Error(`Invalid bib number: ${row.sourceUid}`);
      if (!row.categoryName.trim() || !row.gender.trim() || !row.detailUrl.trim() || !row.sourceUrl.trim()) {
        throw new Error(`Invalid required source field: ${row.sourceUid}`);
      }
      if ((row.officialTime === null) !== (row.officialTimeMilliseconds === null)) {
        throw new Error(`Invalid official time pair: ${row.sourceUid}`);
      }
      if (row.officialTimeMilliseconds !== null && row.officialTimeMilliseconds < 0) throw new Error(`Invalid official time: ${row.sourceUid}`);
      const categoryRankValid =
        (row.categoryRank === null && row.categoryTotal === null) ||
        (row.categoryRank !== null && row.categoryTotal !== null && row.categoryRank > 0 && row.categoryRank <= row.categoryTotal);
      if (!categoryRankValid) throw new Error(`Invalid category rank pair: ${row.sourceUid}`);
      const genderRankValid =
        (row.genderRank === null && row.genderTotal === null) ||
        (row.genderRank !== null && row.genderTotal !== null && row.genderRank > 0 && row.genderRank <= row.genderTotal);
      if (!genderRankValid) throw new Error(`Invalid gender rank pair: ${row.sourceUid}`);
      if (row.position !== null) {
        if (!Number.isSafeInteger(row.position) || row.position <= 0) throw new Error(`Invalid position: ${row.sourceUid}`);
        const positionKey = `${row.eventId}:${row.position}`;
        if (seenPositions.has(positionKey)) throw new Error(`Duplicate position: ${positionKey}`);
        seenPositions.add(positionKey);
      }
      if (row.status !== null && !["CUT", "DNF", "DNS"].includes(row.status)) throw new Error(`Invalid result status: ${row.sourceUid}`);
      if (!Array.isArray(row.checkpoints) || row.checkpoints.some((checkpoint) => !checkpoint.label || typeof checkpoint.value !== "string")) {
        throw new Error(`Invalid checkpoints: ${row.sourceUid}`);
      }
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

export async function importScoreNowBatches(
  dataset: ScoreNowDataset,
  batchSize: number,
  importBatch: (rows: ScoreNowImportRow[]) => Promise<number>,
) {
  const batches = toScoreNowImportBatches(dataset, batchSize);
  let importedRows = 0;
  for (let index = 0; index < batches.length; index += 1) {
    const expected = batches[index].rows.length;
    const affected = await importBatch(batches[index].rows);
    if (affected !== expected) throw new Error(`ScoreNow batch ${index + 1} acknowledged ${affected}/${expected} rows`);
    importedRows += affected;
  }
  return { batches: batches.length, rows: importedRows };
}
