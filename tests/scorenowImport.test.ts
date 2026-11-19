import { describe, expect, it } from "vitest";
import { toScoreNowImportBatches } from "@/lib/scorenow/import";
import type { ScoreNowDataset, ScoreNowResult } from "@/lib/scorenow/types";

function result(overrides: Partial<ScoreNowResult> = {}): ScoreNowResult {
  return {
    competitionId: 19723,
    raceId: 308,
    eventId: 1,
    sourceUid: "19723-308-1-536843",
    category: "10K",
    position: 1,
    bibNumber: "14279",
    name: "Runner One",
    officialTime: "00:33:25.213",
    officialTimeMilliseconds: 2_005_213,
    categoryName: "Top 3 Umum",
    categoryRank: 1,
    categoryTotal: 3,
    gender: "Male",
    genderRank: 1,
    genderTotal: 2100,
    checkpoints: [{ label: "Finish", value: "0:35.9" }],
    detailUrl: "https://results.scorenow.co.id/myresults.aspx?uid=19723-308-1-536843",
    sourceUrl: "https://results.scorenow.co.id/results.aspx?CId=19723&RId=308&EId=1&PageNo=1",
    scrapedAt: "2026-11-19T03:00:00.000Z",
    ...overrides,
  };
}

function dataset(): ScoreNowDataset {
  const first = result();
  const second = result({
    eventId: 2,
    sourceUid: "19723-308-2-533765",
    category: "5K",
    position: null,
    bibNumber: "51531",
    officialTime: null,
    officialTimeMilliseconds: null,
    categoryName: "Umum",
    categoryRank: null,
    categoryTotal: null,
    genderRank: null,
    genderTotal: null,
  });
  return {
    competitionId: 19723,
    raceId: 308,
    raceName: "Soekarno Run 2026",
    raceDate: "2026-02-15",
    sourceUrl: "https://results.scorenow.co.id/results.aspx?CId=19723&RId=308",
    scrapedAt: "2026-11-19T03:00:00.000Z",
    totalResults: 2,
    categories: [
      { eventId: 1, category: "10K", declaredTotal: 1, totalPages: 1, results: [first] },
      { eventId: 2, category: "5K", declaredTotal: 1, totalPages: 1, results: [second] },
    ],
  };
}

describe("toScoreNowImportBatches", () => {
  it("maps source rows literally, including checkpoint JSON and nullable rankings", () => {
    const [batch] = toScoreNowImportBatches(dataset(), 10);

    expect(batch.rows).toEqual([
      {
        competition_id: 19723,
        race_id: 308,
        source_event_id: 1,
        source_uid: "19723-308-1-536843",
        race_name: "Soekarno Run 2026",
        race_date: "2026-02-15",
        category: "10K",
        position: 1,
        bib_number: "14279",
        runner_name: "Runner One",
        official_time: "00:33:25.213",
        official_time_ms: 2_005_213,
        source_category: "Top 3 Umum",
        category_rank: 1,
        category_total: 3,
        gender: "Male",
        gender_rank: 1,
        gender_total: 2100,
        checkpoints: [{ label: "Finish", value: "0:35.9" }],
        detail_url: "https://results.scorenow.co.id/myresults.aspx?uid=19723-308-1-536843",
        source_url: "https://results.scorenow.co.id/results.aspx?CId=19723&RId=308&EId=1&PageNo=1",
        scraped_at: "2026-11-19T03:00:00.000Z",
      },
      expect.objectContaining({
        source_event_id: 2,
        category: "5K",
        position: null,
        official_time: null,
        official_time_ms: null,
        category_rank: null,
        category_total: null,
        gender_rank: null,
        gender_total: null,
      }),
    ]);
  });

  it("splits rows at exact batch boundaries", () => {
    expect(toScoreNowImportBatches(dataset(), 1).map((batch) => batch.rows.length)).toEqual([1, 1]);
    expect(() => toScoreNowImportBatches(dataset(), 0)).toThrow("batch size");
  });

  it("rejects invalid dataset and per-category totals", () => {
    expect(() => toScoreNowImportBatches({ ...dataset(), totalResults: 3 }, 10)).toThrow("dataset total");
    const invalidCategory = dataset();
    invalidCategory.categories[0].declaredTotal = 2;
    expect(() => toScoreNowImportBatches(invalidCategory, 10)).toThrow("10K declared total");
  });

  it("never manufactures trusted registration fields", () => {
    const forbidden = new Set(["email", "phone", "date_of_birth", "id_number", "consent", "runner_id", "user_id"]);
    for (const row of toScoreNowImportBatches(dataset(), 10).flatMap((batch) => batch.rows)) {
      expect(Object.keys(row).filter((key) => forbidden.has(key))).toEqual([]);
    }
  });
});
