import { createHash } from "node:crypto";

export type LegacyScoreNowRow = {
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
  result_status: "CUT" | "DNF" | "DNS" | null;
  official_time: string | null;
  official_time_ms: number | null;
  source_category: string;
  category_rank: number | null;
  category_total: number | null;
  gender: string;
  gender_rank: number | null;
  gender_total: number | null;
  checkpoints: Array<{ label: string; value: string }>;
  detail_url: string;
  source_url: string;
  scraped_at: string;
};

export type ScoreNowPublicationCheckpoint = {
  sequence: number;
  label: string;
  distanceMeters: number;
  displayedTimeMs: number;
  reportedSplitMs: number;
  referenceLabel: string;
};

export type ScoreNowPublicationRow = {
  distance: "5K" | "10K";
  page_number: 1;
  row_number: number;
  bib: string;
  name: string;
  gender: string | null;
  division: string | null;
  status: "finished" | "dnf" | "dns";
  finish_time_ms: number | null;
  net_time_ms: number | null;
  overall_rank: number | null;
  division_rank: number | null;
  gender_rank: number | null;
  source_uid: string;
  source_url: string;
  detail_outcome: "resolved";
  detail_identity: {
    competitionId: string;
    raceId: string;
    bib: string;
    distance: "5K" | "10K";
    sourceUid: string;
  };
  checkpoints: ScoreNowPublicationCheckpoint[];
  raw_source: string;
};

export type ScoreNowPublicationManifest = {
  competitionId: 19723;
  raceId: 308;
  eventId: 1;
  distances: {
    "5K": { advertisedTotal: 5987; pageCount: 1 };
    "10K": { advertisedTotal: 3995; pageCount: 1 };
  };
};

export type ScoreNowPublicationPlan = {
  digest: string;
  manifest: ScoreNowPublicationManifest;
  pages: Array<{ distance: "5K" | "10K"; page_number: 1; row_count: number }>;
  rows: ScoreNowPublicationRow[];
  batches: ScoreNowPublicationRow[][];
};

const EXPECTED_COUNTS = { "5K": 5_987, "10K": 3_995 } as const;

function parseDurationMilliseconds(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null;
  const seconds = Number(parts.at(-1));
  const minutes = Number(parts.at(-2));
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (!Number.isFinite(seconds) || !Number.isFinite(minutes) || seconds! >= 60 || minutes >= 60) return null;
  return Math.round((hours * 3_600 + minutes * 60 + seconds!) * 1_000);
}

function checkpointDistance(label: string, distance: "5K" | "10K"): number | null {
  if (/^finish$/i.test(label.trim())) return distance === "5K" ? 5_000 : 10_000;
  const match = label.match(/\bKM\s*(\d+(?:[.,]\d+)?)\b/i);
  if (!match) return null;
  const kilometers = Number(match[1].replace(",", "."));
  if (!Number.isFinite(kilometers) || kilometers <= 0) return null;
  return Math.round(kilometers * 1_000);
}

function normalizeCheckpoints(row: LegacyScoreNowRow): ScoreNowPublicationCheckpoint[] {
  const normalized: ScoreNowPublicationCheckpoint[] = [];
  let displayedTimeMs = 0;
  for (const checkpoint of row.checkpoints) {
    const reportedSplitMs = parseDurationMilliseconds(checkpoint.value);
    const distanceMeters = checkpointDistance(checkpoint.label, row.category);
    if (reportedSplitMs === null || distanceMeters === null) continue;
    displayedTimeMs += reportedSplitMs;
    const kmMatch = checkpoint.label.match(/\bKM\s*(\d+(?:[.,]\d+)?)\b/i);
    normalized.push({
      sequence: normalized.length + 1,
      label: checkpoint.label.trim(),
      distanceMeters,
      displayedTimeMs,
      reportedSplitMs,
      referenceLabel: /^finish$/i.test(checkpoint.label.trim()) ? "Finish" : `KM ${kmMatch![1].replace(",", ".")}`,
    });
  }
  return normalized;
}

function validateRows(rows: LegacyScoreNowRow[]) {
  const counts = { "5K": 0, "10K": 0 };
  const bibs = new Set<string>();
  const sourceUids = new Set<string>();
  for (const row of rows) {
    const expectedEvent = row.category === "10K" ? 1 : row.category === "5K" ? 2 : null;
    if (row.competition_id !== 19723 || row.race_id !== 308 || row.source_event_id !== expectedEvent) {
      throw new Error(`Invalid ScoreNow provenance: ${row.source_uid}`);
    }
    counts[row.category] += 1;
    const bib = row.bib_number.trim();
    const bibKey = bib.toUpperCase();
    if (!bib) throw new Error(`Invalid BIB: ${row.source_uid}`);
    if (bibs.has(bibKey)) throw new Error(`Duplicate BIB: ${bib}`);
    bibs.add(bibKey);
    const sourceUid = row.source_uid.trim();
    if (!sourceUid) throw new Error(`Invalid source UID for BIB ${bib}`);
    if (sourceUids.has(sourceUid)) throw new Error(`Duplicate source UID: ${sourceUid}`);
    sourceUids.add(sourceUid);
    const hasTime = row.official_time !== null && row.official_time_ms !== null;
    if ((row.official_time === null) !== (row.official_time_ms === null) || row.official_time_ms !== null && row.official_time_ms < 0) {
      throw new Error(`Invalid timing pair: ${sourceUid}`);
    }
    if ((row.result_status === null) !== hasTime) throw new Error(`Invalid result status/timing: ${sourceUid}`);
    if (!row.detail_url.startsWith("https://results.scorenow.co.id/")) throw new Error(`Invalid detail URL: ${sourceUid}`);
  }
  for (const distance of ["5K", "10K"] as const) {
    if (counts[distance] !== EXPECTED_COUNTS[distance]) {
      throw new Error(`${distance} total mismatch: ${counts[distance]}/${EXPECTED_COUNTS[distance]}`);
    }
  }
}

function statusFor(row: LegacyScoreNowRow): ScoreNowPublicationRow["status"] {
  if (row.result_status === "DNS") return "dns";
  if (row.result_status === "CUT" || row.result_status === "DNF") return "dnf";
  return "finished";
}

export function buildScoreNowPublication(rows: LegacyScoreNowRow[]): ScoreNowPublicationPlan {
  validateRows(rows);
  const ordered = [...rows].sort((left, right) => {
    const categoryOrder = (left.category === "5K" ? 0 : 1) - (right.category === "5K" ? 0 : 1);
    if (categoryOrder !== 0) return categoryOrder;
    return left.bib_number.localeCompare(right.bib_number, "en", { numeric: true, sensitivity: "base" }) || left.source_uid.localeCompare(right.source_uid);
  });
  const rowNumbers = { "5K": 0, "10K": 0 };
  const publicationRows = ordered.map((row): ScoreNowPublicationRow => {
    const bib = row.bib_number.trim();
    rowNumbers[row.category] += 1;
    return {
      distance: row.category,
      page_number: 1,
      row_number: rowNumbers[row.category],
      bib,
      name: row.runner_name.trim(),
      gender: row.gender.trim() || null,
      division: row.source_category.trim() || null,
      status: statusFor(row),
      finish_time_ms: row.official_time_ms,
      net_time_ms: row.official_time_ms,
      overall_rank: row.position,
      division_rank: row.category_rank,
      gender_rank: row.gender_rank,
      source_uid: row.source_uid.trim(),
      source_url: row.detail_url,
      detail_outcome: "resolved",
      detail_identity: {
        competitionId: "19723",
        raceId: "308",
        bib,
        distance: row.category,
        sourceUid: row.source_uid.trim(),
      },
      checkpoints: normalizeCheckpoints(row),
      raw_source: JSON.stringify(row),
    };
  });
  const manifest: ScoreNowPublicationManifest = {
    competitionId: 19723,
    raceId: 308,
    eventId: 1,
    distances: {
      "5K": { advertisedTotal: 5_987, pageCount: 1 },
      "10K": { advertisedTotal: 3_995, pageCount: 1 },
    },
  };
  const digest = createHash("sha256").update(JSON.stringify({ manifest, rows: publicationRows })).digest("hex");
  const batches: ScoreNowPublicationRow[][] = [];
  for (let offset = 0; offset < publicationRows.length; offset += 100) batches.push(publicationRows.slice(offset, offset + 100));
  return {
    digest,
    manifest,
    pages: [
      { distance: "5K", page_number: 1, row_count: 5_987 },
      { distance: "10K", page_number: 1, row_count: 3_995 },
    ],
    rows: publicationRows,
    batches,
  };
}
