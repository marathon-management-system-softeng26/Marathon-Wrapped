import { describe, expect, it } from "vitest";
import {
  buildScoreNowPublication,
  executeScoreNowPublication,
  type LegacyScoreNowRow,
  type ScoreNowPublicationAdapter,
  type ScoreNowPublicationPlan,
} from "@/lib/scorenow/publication";

function sourceRow(index: number, category: "5K" | "10K"): LegacyScoreNowRow {
  const sourceEventId = category === "10K" ? 1 : 2;
  const bib = `${category === "10K" ? "T" : "F"}${String(index).padStart(5, "0")}`;
  return {
    competition_id: 19723,
    race_id: 308,
    source_event_id: sourceEventId,
    source_uid: `19723-308-${sourceEventId}-fixture-${String(index).padStart(5, "0")}`,
    race_name: "Soekarno Run 2026",
    race_date: "2026-02-15",
    category,
    position: index,
    bib_number: bib,
    runner_name: `Runner ${bib}`,
    result_status: null,
    official_time: "00:40:00.000",
    official_time_ms: 2_400_000,
    source_category: "Umum",
    category_rank: index,
    category_total: category === "10K" ? 3_995 : 5_987,
    gender: index % 2 ? "Male" : "Female",
    gender_rank: index,
    gender_total: category === "10K" ? 3_995 : 5_987,
    checkpoints: [
      { label: "Checkpoint 1 - KM 3.7", value: "11:58.8" },
      { label: "Checkpoint 2 - KM 7.4", value: "12:01.2" },
      { label: "Finish", value: "16:00.0" },
    ],
    detail_url: `https://results.scorenow.co.id/myresults.aspx?uid=19723-308-${sourceEventId}-fixture-${index}`,
    source_url: `https://results.scorenow.co.id/results.aspx?CId=19723&RId=308&EId=${sourceEventId}&PageNo=1`,
    scraped_at: "2026-11-19T03:00:00.000Z",
  };
}

function completeRows(): LegacyScoreNowRow[] {
  return [
    ...Array.from({ length: 3_995 }, (_, index) => sourceRow(index + 1, "10K")),
    ...Array.from({ length: 5_987 }, (_, index) => sourceRow(index + 1, "5K")),
  ];
}

describe("buildScoreNowPublication", () => {
  it("builds the exact deterministic two-page publication in batches of at most 100", () => {
    const rows = completeRows().reverse();
    const first = buildScoreNowPublication(rows);
    const second = buildScoreNowPublication([...rows].reverse());

    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(second.digest).toBe(first.digest);
    expect(first.manifest).toEqual({
      competitionId: 19723,
      raceId: 308,
      eventId: 1,
      distances: {
        "5K": { advertisedTotal: 5_987, pageCount: 1 },
        "10K": { advertisedTotal: 3_995, pageCount: 1 },
      },
    });
    expect(first.pages).toEqual([
      { distance: "5K", page_number: 1, row_count: 5_987 },
      { distance: "10K", page_number: 1, row_count: 3_995 },
    ]);
    expect(first.rows).toHaveLength(9_982);
    expect(first.batches.flat()).toEqual(first.rows);
    expect(Math.max(...first.batches.map((batch) => batch.length))).toBe(100);
    expect(first.rows[0]).toEqual(expect.objectContaining({ distance: "5K", row_number: 1, bib: "F00001" }));
    expect(first.rows[5_987]).toEqual(expect.objectContaining({ distance: "10K", row_number: 1, bib: "T00001" }));
  });

  it("maps result status, rankings, official time, identity, and normalized checkpoints", () => {
    const rows = completeRows();
    rows[0] = {
      ...rows[0],
      position: 7,
      category_rank: 3,
      gender_rank: 4,
      source_category: "Top 3 Umum",
    };
    rows[1] = {
      ...rows[1],
      result_status: "CUT",
      position: null,
      official_time: null,
      official_time_ms: null,
      category_rank: null,
      gender_rank: null,
      checkpoints: [{ label: "Checkpoint 1 - KM 3.7", value: "" }],
    };
    rows[2] = { ...rows[1], source_uid: rows[2].source_uid, bib_number: rows[2].bib_number, runner_name: rows[2].runner_name, result_status: "DNF" };
    rows[3] = { ...rows[1], source_uid: rows[3].source_uid, bib_number: rows[3].bib_number, runner_name: rows[3].runner_name, result_status: "DNS" };

    const plan = buildScoreNowPublication(rows);
    const finished = plan.rows.find((row) => row.bib === "T00001");
    expect(finished).toEqual(expect.objectContaining({
      status: "finished",
      finish_time_ms: 2_400_000,
      net_time_ms: 2_400_000,
      overall_rank: 7,
      division: "Top 3 Umum",
      division_rank: 3,
      gender_rank: 4,
      detail_outcome: "resolved",
      detail_identity: {
        competitionId: "19723",
        raceId: "308",
        bib: "T00001",
        distance: "10K",
        sourceUid: rows[0].source_uid,
      },
      checkpoints: [
        { sequence: 1, label: "Checkpoint 1 - KM 3.7", distanceMeters: 3_700, displayedTimeMs: 718_800, reportedSplitMs: 718_800, referenceLabel: "KM 3.7" },
        { sequence: 2, label: "Checkpoint 2 - KM 7.4", distanceMeters: 7_400, displayedTimeMs: 1_440_000, reportedSplitMs: 721_200, referenceLabel: "KM 7.4" },
        { sequence: 3, label: "Finish", distanceMeters: 10_000, displayedTimeMs: 2_400_000, reportedSplitMs: 960_000, referenceLabel: "Finish" },
      ],
    }));
    expect(plan.rows.find((row) => row.bib === "T00002")).toEqual(expect.objectContaining({ status: "dnf", checkpoints: [] }));
    expect(plan.rows.find((row) => row.bib === "T00003")?.status).toBe("dnf");
    expect(plan.rows.find((row) => row.bib === "T00004")?.status).toBe("dns");
  });

  it("refuses partial, duplicate, inconsistent, or foreign source data", () => {
    const rows = completeRows();
    expect(() => buildScoreNowPublication(rows.slice(1))).toThrow("10K total");
    expect(() => buildScoreNowPublication([...rows.slice(0, -1), { ...rows.at(-1)!, bib_number: rows[0].bib_number }])).toThrow("Duplicate BIB");
    expect(() => buildScoreNowPublication([...rows.slice(0, -1), { ...rows.at(-1)!, source_uid: rows[0].source_uid }])).toThrow("Duplicate source UID");
    expect(() => buildScoreNowPublication([{ ...rows[0], competition_id: 1 }, ...rows.slice(1)])).toThrow("provenance");
    expect(() => buildScoreNowPublication([{ ...rows[0], official_time_ms: null }, ...rows.slice(1)])).toThrow("timing");
    expect(() => buildScoreNowPublication([{ ...rows[0], result_status: "DNS", official_time: "00:40:00.000", official_time_ms: 2_400_000 }, ...rows.slice(1)])).toThrow("timing");
  });
});

class MemoryPublicationAdapter implements ScoreNowPublicationAdapter {
  readonly sourceRows: LegacyScoreNowRow[];
  event = { id: 1, competitionId: 999001, raceId: 999002 };
  fetches: Array<{ offset: number; limit: number }> = [];
  writes: string[] = [];
  stagedBatchSizes: number[] = [];
  runners = new Set<string>();
  runs = new Map<string, { id: string; digest: string; publishedAt: string | null; plan: ScoreNowPublicationPlan }>();
  counts: number[] = [];

  constructor(rows = completeRows()) {
    this.sourceRows = rows;
  }

  async getEvent() {
    return this.event;
  }

  async countSourceRows() {
    return this.counts.shift() ?? this.sourceRows.length;
  }

  async fetchSourceRows(offset: number, limit: number) {
    this.fetches.push({ offset, limit });
    return this.sourceRows.slice(offset, offset + limit);
  }

  async findRun(digest: string) {
    return [...this.runs.values()].find((run) => run.digest === digest) ?? null;
  }

  async createRun(plan: ScoreNowPublicationPlan) {
    this.writes.push("create-run");
    const run = { id: `run-${this.runs.size + 1}`, digest: plan.digest, publishedAt: null, plan };
    this.runs.set(run.id, run);
    return run;
  }

  async ensurePages() {
    this.writes.push("ensure-pages");
  }

  async stageRows(_runId: string, _digest: string, rows: ScoreNowPublicationPlan["rows"]) {
    this.writes.push("stage");
    this.stagedBatchSizes.push(rows.length);
    return rows.length;
  }

  async configureRealEventSource() {
    this.writes.push("configure-event");
    if (this.event.competitionId !== 999001 || this.event.raceId !== 999002) return false;
    this.event = { ...this.event, competitionId: 19723, raceId: 308 };
    return true;
  }

  async publishRun(runId: string) {
    this.writes.push("publish");
    const run = this.runs.get(runId)!;
    run.publishedAt = "2026-11-24T00:00:00.000Z";
    for (const row of run.plan.rows) this.runners.add(row.source_uid);
    return { eventId: 1, counts: { "5K": 5_987, "10K": 3_995 } } as const;
  }
}

describe("executeScoreNowPublication", () => {
  it("paginates a complete source snapshot and performs a zero-write dry-run", async () => {
    const adapter = new MemoryPublicationAdapter();
    const result = await executeScoreNowPublication(adapter, {
      projectRef: "anbnuegocddoowagqmxw",
      publish: false,
      pageSize: 1_000,
    });

    expect(result.mode).toBe("dry-run");
    expect(result.plan.rows).toHaveLength(9_982);
    expect(adapter.fetches).toEqual(Array.from({ length: 10 }, (_, index) => ({
      offset: index * 1_000,
      limit: index === 9 ? 982 : 1_000,
    })));
    expect(adapter.writes).toEqual([]);
  });

  it("refuses the wrong project, a short page, a changed count, or an unknown event configuration", async () => {
    await expect(executeScoreNowPublication(new MemoryPublicationAdapter(), {
      projectRef: "wrong-project",
      publish: false,
    })).rejects.toThrow("project");

    const short = new MemoryPublicationAdapter();
    short.fetchSourceRows = async (offset, limit) => short.sourceRows.slice(offset, offset + Math.max(0, limit - 1));
    await expect(executeScoreNowPublication(short, { projectRef: "anbnuegocddoowagqmxw", publish: false })).rejects.toThrow("short page");

    const changed = new MemoryPublicationAdapter();
    changed.counts = [9_982, 9_981];
    await expect(executeScoreNowPublication(changed, { projectRef: "anbnuegocddoowagqmxw", publish: false })).rejects.toThrow("changed");

    const unknownEvent = new MemoryPublicationAdapter();
    unknownEvent.event = { id: 1, competitionId: 123, raceId: 456 };
    await expect(executeScoreNowPublication(unknownEvent, { projectRef: "anbnuegocddoowagqmxw", publish: true })).rejects.toThrow("event configuration");
    expect(unknownEvent.writes).toEqual([]);
  });

  it("publishes in bounded batches and reuses an already-published digest idempotently", async () => {
    const adapter = new MemoryPublicationAdapter();
    const options = { projectRef: "anbnuegocddoowagqmxw", publish: true } as const;
    const first = await executeScoreNowPublication(adapter, options);

    expect(first.mode).toBe("published");
    expect(adapter.event).toEqual({ id: 1, competitionId: 19723, raceId: 308 });
    expect(adapter.stagedBatchSizes).toHaveLength(100);
    expect(Math.max(...adapter.stagedBatchSizes)).toBe(100);
    expect(adapter.runners.size).toBe(9_982);
    expect(adapter.runs.size).toBe(1);

    const writesAfterFirst = adapter.writes.length;
    const second = await executeScoreNowPublication(adapter, options);
    expect(second.mode).toBe("already-published");
    expect(second.runId).toBe(first.runId);
    expect(adapter.writes).toHaveLength(writesAfterFirst);
    expect(adapter.runners.size).toBe(9_982);
    expect(adapter.runs.size).toBe(1);
  });
});
