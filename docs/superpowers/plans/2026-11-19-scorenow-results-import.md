# ScoreNow Results Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproducibly scrape every public 10K and 5K result from ScoreNow's Soekarno Run 2026 page and store the normalized, source-faithful records in the dedicated Marathon Wrapped Supabase project.

**Architecture:** A pure parser converts ScoreNow result HTML into typed rows without inventing registration fields. A command-line scraper fetches the two category result sets, validates page and row counts, and writes one ignored JSON artifact. A server-only Supabase staging table receives idempotent upserts; it remains separate from the trusted 2027 `runners`/`chip_results` model because the public source lacks date of birth, contact, identity-document, consent, and registration ownership fields.

**Tech Stack:** Node.js 22+, TypeScript with native type stripping, Vitest, PostgreSQL 17, Supabase MCP, ScoreNow public HTML.

**Spec:** `docs/SRS_v4.md` (legacy organizer data and trusted-registration boundaries), plus the user-authorized source `https://results.scorenow.co.id/results.aspx?CId=19723&RId=308`.

## Global Constraints

- Import both source categories: `EId=1` (10K) and `EId=2` (5K).
- Preserve public source values and provenance; do not fabricate missing registration fields or claim that Soekarno Run 2026 is the 2027 demo event.
- Keep scraped participant data server-only: RLS enabled and all privileges revoked from `anon` and `authenticated`.
- Store checkpoint labels and values as JSON because 10K and 5K expose different checkpoint layouts.
- Re-running the import must update the same source rows without duplication.
- Abort before database writes if page counts, declared result totals, row uniqueness, or required fields do not validate.
- Do not commit the 9,982-row scrape artifact; commit only parser, scraper, migration, tests, and documentation.

## Review Focus

- Responsive duplicate cells and the optional 5K favorite column must not shift BIB/name/time extraction; Task 1 tests both HTML shapes.
- HTML entities, whitespace, and Indonesian category labels must remain readable; Task 1 tests decoding and normalization.
- A partial fetch, duplicate source UID, or source total mismatch must abort rather than import an incomplete dataset; Task 2 tests the complete-run validator.
- Import retries must not duplicate rows and must not expose the staging table to browser roles; Task 3 tests uniqueness and catalog privileges.
- 2026 source rows must never be inserted into trusted 2027 registration/result tables; Task 3 and the verification queries pin the separate-table boundary.

---

### Task 1: Parse ScoreNow result pages

**Files:**
- Create: `lib/scorenow/types.ts`
- Create: `lib/scorenow/parser.ts`
- Create: `tests/scorenowParser.test.ts`

**Interfaces:**
- Produces: `parseScoreNowPage(html: string, context: ScoreNowPageContext): ScoreNowPage`.
- `ScoreNowResult` contains source IDs, race/category labels, position, BIB, name, official time text and milliseconds, category/gender ranks, checkpoint JSON, detail URL, and scrape provenance.

- [ ] **Step 1: Write failing parser tests** for one 10K row, one 5K row with a favorite cell, HTML entities/whitespace, malformed time, and duplicate responsive cells.
- [ ] **Step 2: Run** `npx vitest run tests/scorenowParser.test.ts`.
  **Expected:** FAIL because `lib/scorenow/parser.ts` does not exist.
- [ ] **Step 3: Implement the minimal typed parser** using source CSS classes and link parameters, deriving duration milliseconds only from the official `TIME` value and preserving checkpoint labels/values verbatim.
- [ ] **Step 4: Run** `npx vitest run tests/scorenowParser.test.ts`.
  **Expected:** PASS.
- [ ] **Step 5: Commit** `feat: parse ScoreNow result pages`.

### Task 2: Scrape and validate the complete public dataset

**Files:**
- Create: `lib/scorenow/scraper.ts`
- Create: `scripts/scrape-scorenow.mts`
- Create: `tests/scorenowScraper.test.ts`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: `parseScoreNowPage()` from Task 1.
- Produces: `scrapeScoreNow(fetchPage, options): Promise<ScoreNowDataset>` and ignored `.data/scorenow/soekarno-run-2026.json`.

- [ ] **Step 1: Write failing scraper tests** for 80-page/3,995-row 10K metadata, 120-page/5,987-row 5K metadata, retryable fetch failure, duplicate UID, missing page, and declared-total mismatch.
- [ ] **Step 2: Run** `npx vitest run tests/scorenowScraper.test.ts`.
  **Expected:** FAIL because the scraper is absent.
- [ ] **Step 3: Implement bounded concurrent fetching** with a descriptive user agent, retry/backoff, deterministic page ordering, exact total validation, and atomic artifact replacement.
- [ ] **Step 4: Run** `npx vitest run tests/scorenowParser.test.ts tests/scorenowScraper.test.ts`.
  **Expected:** PASS.
- [ ] **Step 5: Run** `npm run scrape:scorenow`.
  **Expected:** exactly 9,982 validated rows: 3,995 10K and 5,987 5K; no duplicate `(race_id, event_id, source_uid)`.
- [ ] **Step 6: Commit** `feat: scrape complete ScoreNow results`.

### Task 3: Add a server-only, idempotent import boundary

**Files:**
- Create: `supabase/migrations/20261119032732_scorenow_result_import.sql`
- Create: `tests/sql/scorenow-result-import.sql`
- Create: `lib/scorenow/import.ts`
- Create: `tests/scorenowImport.test.ts`

**Interfaces:**
- Consumes: validated `ScoreNowDataset` rows from Task 2.
- Produces: `toScoreNowImportBatches(dataset, batchSize): ScoreNowImportBatch[]`; table `public.scorenow_results`; service-only RPC `import_scorenow_results(p_rows jsonb) -> integer`.

- [ ] **Step 1: Write failing import-mapping tests** for literal field mapping, checkpoint JSON, batch boundaries, invalid source totals, and no trusted-registration fields.
- [ ] **Step 2: Run** `npx vitest run tests/scorenowImport.test.ts`.
  **Expected:** FAIL because the import mapper is absent.
- [ ] **Step 3: Implement the mapper and additive migration** with source-key uniqueness, checks, timestamps, RLS, explicit browser-role revokes, service-role grants, and an idempotent JSONB upsert RPC with a locked search path.
- [ ] **Step 4: Run** `npx vitest run tests/scorenowImport.test.ts` and `npm test`.
  **Expected:** focused and full suites pass.
- [ ] **Step 5: Apply the migration** to dedicated project `anbnuegocddoowagqmxw` through Supabase migration tooling.
  **Expected:** the table/RPC exist, RLS is enabled, and `anon`/`authenticated` have no table or function privilege.
- [ ] **Step 6: Commit** `feat: add ScoreNow result import storage`.

### Task 4: Import, verify, and document the dataset

**Files:**
- Modify: `db/README.md`
- Create: `docs/qa/scorenow-results-import.md`

**Interfaces:**
- Consumes: the ignored Task 2 artifact and Task 3 RPC.
- Produces: 9,982 verified server-only Supabase rows and reproducible QA evidence.

- [ ] **Step 1: Import the validated artifact in bounded JSON batches** through the service-only RPC.
  **Expected:** every batch count matches its input count and re-importing a sample batch does not change total rows.
- [ ] **Step 2: Verify database invariants**: 3,995 10K, 5,987 5K, 9,982 unique source UIDs, positions bounded by category totals, no null required fields, and source race date `2026-02-15`.
  **Expected:** every query returns its literal expected count/value.
- [ ] **Step 3: Run advisors and project gates**: `npm test`, `npm run test:native`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
  **Expected:** all runnable gates pass; environment-gated skips remain named.
- [ ] **Step 4: Record source, timestamp, counts, schema boundary, commands, advisor results, and limitations** without copying participant rows into documentation.
- [ ] **Step 5: Commit** `test: verify ScoreNow results import`.

## Self-review

- Coverage: source inspection, parsing, complete scrape, secure staging, idempotent import, Supabase verification, and evidence are assigned.
- Interface check: Task 2 consumes Task 1; Task 3 consumes Task 2; Task 4 consumes Tasks 2–3 with matching types and names.
- Scope ruling: a separate staging table is required by SRS V4's trusted-registration boundary and the source's missing registration fields; direct insertion into `runners` would require fabricated personal data.

## Execution status and Claude handoff — 2026-11-19

Tasks 1–4 are implemented and committed through `3ddef70`. The required fresh whole-branch review then found seven Important issues; the single permitted TDD fix pass is implemented and verified for the handoff commit.

Completed review fixes:

- Preserve and live-backfill all 2,183 explicit outcomes: 10K `CUT=62`, `DNF=18`, `DNS=775`; 5K `CUT=16`, `DNF=12`, `DNS=1300`.
- Align committed migration versions with hosted history: `20261119032732`, `20261119033210`, and newly applied `20261119102908`.
- Validate the entire artifact before producing or importing any batch: provenance, category coverage, UID and position uniqueness, required fields, nullable pairs, ranks, checkpoints, and statuses.
- Reject captured rows whose UID competition/race/event does not match the requested page context.
- Remove immediate database position uniqueness and cover corrected cross-batch position swaps in rollback-wrapped SQL; final uniqueness is enforced before the first RPC.
- Replace real-participant test fixtures with synthetic identifiers and values.
- Require a capture manifest with the original timestamp and add a guarded, acknowledgement-checking `npm run import:scorenow` workflow.

Live Supabase state:

- Project `anbnuegocddoowagqmxw` contains 9,982 rows and 9,982 distinct source UIDs.
- `result_status` is backfilled with the exact six category/status totals above; zero unranked rows lack a status.
- Browser roles remain denied; the service-only invoker RPC retains `search_path = ''`.
- The ranked-position index is removed. Full three-migration replay was verified transactionally in a disposable schema and rolled back.

Verification at handoff:

- Focused ScoreNow suite: 24 passed.
- Full Vitest suite: 660 passed, 21 environment-gated integration skips.
- Native suite: 35 passed, 1 PostgreSQL/PGlite environment-gated skip.
- `npm run lint`, `npx tsc --noEmit`, and `npm run build`: passed.
- Updated rollback-wrapped SQL regression: passed against the dedicated project.
- Three-migration replay and upgrade path: passed in a disposable hosted schema and rolled back.

Claude should begin from the named `codex/scorenow-results-import` branch and `git status`. Do not dispatch a second review: the executing-plans skill allows only the completed fresh reviewer and verifies Important fixes through RED→GREEN tests plus the green suite above. The reviewer’s three Minor findings are deliberately deferred: POSIX path fixture, no repository SQL-test entry point, and the blank-name ranked/unranked wording detail.
