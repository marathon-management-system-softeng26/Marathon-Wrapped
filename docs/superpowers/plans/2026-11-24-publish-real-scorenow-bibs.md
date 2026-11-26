# Publish Real ScoreNow BIBs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish all 9,982 validated ScoreNow results for application event `1` so real race BIBs resolve through the existing registration flow.

**Architecture:** Convert the legacy `scorenow_results` rows into the existing reviewed `scorenow_import_*` staging contract, then invoke the transactional `publish_scorenow_import` RPC. A pure TypeScript transformer owns validation and mapping; a guarded command owns Supabase pagination, staging, dry-run reporting, publication, and verification.

**Tech Stack:** TypeScript, Node.js, Vitest, Supabase/PostgreSQL, existing ScoreNow publication RPCs

**Spec:** `docs/superpowers/specs/2026-11-24-publish-real-scorenow-bibs-design.md`

## Global Constraints

- Only project `anbnuegocddoowagqmxw`, application event `1`, competition `19723`, and race `308` are permitted.
- Publish 3,995 10K and 5,987 5K rows; refuse partial or duplicate input.
- Registration continues reading only `official_race_results`.
- Preserve the two claimed `HERO-*` demo registrations and all existing ownership.
- Do not create Auth users or assign runner ownership.
- Remote publication requires an explicit `--publish` flag; the default command is dry-run only.

## Review Focus

- A duplicate BIB across 5K/10K must abort before remote writes — Task 1 duplicate-identity test.
- CUT/DNF/DNS and untimed rows must not become false finishers — Task 1 status-mapping tests.
- Blank/malformed checkpoint values must be omitted without corrupting official time — Task 1 checkpoint tests.
- A partial paginated fetch or changed row total must abort before staging — Task 2 adapter/orchestration tests.
- A rerun with the same digest must be idempotent and must not duplicate runners — Task 2 idempotency test and Task 3 database verification.

---

### Task 1: Legacy Import Publication Transformer

**Files:**
- Create: `lib/scorenow/publication.ts`
- Create: `tests/scorenowPublication.test.ts`

**Interfaces:**
- Consumes: legacy `scorenow_results` rows for competition `19723` / race `308`.
- Produces: `buildScoreNowPublication(rows: LegacyScoreNowRow[]): ScoreNowPublicationPlan`, containing a deterministic digest, manifest, two logical pages, and stage batches of at most 100 rows.

- [ ] **Step 1: Write failing transformer tests**

Cover exact provenance/totals, deterministic ordering and digest, unique BIB/source UID enforcement, `null → finished`, `CUT → dnf`, `DNF → dnf`, `DNS → dns`, official/net time mapping, and checkpoint normalization from raw `{label,value}` pairs.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- tests/scorenowPublication.test.ts`

Expected: FAIL because `@/lib/scorenow/publication` does not exist.

- [ ] **Step 3: Implement the pure transformer**

Implement `buildScoreNowPublication(rows)` with fixed project provenance, exact counts `3995/5987`, deterministic row numbers, SHA-256 digest, one logical page per distance, and 100-row stage batches. Parse checkpoint durations, accumulate displayed time, infer kilometer distances from labels, and use the category distance for `Finish`.

- [ ] **Step 4: Run focused and adjacent tests**

Run: `npm test -- tests/scorenowPublication.test.ts tests/scorenowImport.test.ts tests/scorenowParser.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scorenow/publication.ts tests/scorenowPublication.test.ts
git commit -m "feat: transform imported ScoreNow results for publication"
```

### Task 2: Guarded Publication Command

**Files:**
- Create: `scripts/publish-scorenow.mts`
- Modify: `package.json`
- Modify: `tests/scorenowPublication.test.ts`

**Interfaces:**
- Consumes: `buildScoreNowPublication`, Supabase server credentials, and `--publish`.
- Produces: `npm run publish:scorenow` dry-run and `npm run publish:scorenow -- --publish` transactional publication workflow.

- [ ] **Step 1: Add failing orchestration tests**

Test complete pagination, refusal on a short/changed fetch, dry-run making zero writes, staging in batches of at most 100, explicit publish gating, and idempotent reuse of an existing digest/run.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- tests/scorenowPublication.test.ts`

Expected: FAIL because the publication orchestration interface is missing.

- [ ] **Step 3: Implement the guarded command**

Add a small injectable adapter in `lib/scorenow/publication.ts` for fetch/create/stage/publish operations, then wire it to `@supabase/supabase-js` in `scripts/publish-scorenow.mts`. Verify the project ref and event configuration before reading rows. Add the `publish:scorenow` package script with `.env.local` loading.

- [ ] **Step 4: Run dry-run and automated verification**

Run: `npm run publish:scorenow`

Expected: reports 9,982 rows, 3,995 10K, 5,987 5K, two logical pages, deterministic digest, and zero writes.

Run: `npm test -- tests/scorenowPublication.test.ts && npm run lint && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scorenow/publication.ts scripts/publish-scorenow.mts tests/scorenowPublication.test.ts package.json
git commit -m "feat: add guarded ScoreNow publication command"
```

### Task 3: Publish and Verify the Real Registration Catalog

**Files:**
- Modify if evidence changes: `docs/qa/acceptance-matrix.md`

**Interfaces:**
- Consumes: the guarded publication command and connected project `anbnuegocddoowagqmxw`.
- Produces: 9,982 real published ScoreNow results discoverable through event edition `1` BIB registration.

- [ ] **Step 1: Capture pre-publication counts**

Read counts for `scorenow_results`, `official_race_results`, `runner_access`, and the existing published run. Confirm no real ScoreNow publication has already occurred.

- [ ] **Step 2: Execute the guarded publication**

Run: `npm run publish:scorenow -- --publish`

Expected: stages the reviewed run, publishes once, and reports `{ "5K": 5987, "10K": 3995 }`.

- [ ] **Step 3: Verify database invariants**

Confirm 9,982 real rows reference the new run, 9,982 `source_kind='scorenow'` runners exist, BIB/source UID uniqueness holds, the two `HERO-*` records and ownership rows remain, and no new Auth users or runner-access rows were created.

- [ ] **Step 4: Verify a real registration lookup**

Call the same local `/api/auth/bib/lookup` path used by the UI with event `1` and BIB `14279`; confirm it returns the matching real runner, then revoke the temporary lookup ticket through the existing API cleanup path.

- [ ] **Step 5: Run full verification and record evidence**

Run: `npm test && npm run test:native && npm run lint && npm run build`

Expected: PASS, with environment-gated skips reported explicitly.

Update `docs/qa/acceptance-matrix.md` with publication counts, run digest, sample BIB lookup, and preserved ownership evidence.

- [ ] **Step 6: Commit**

```bash
git add docs/qa/acceptance-matrix.md
git commit -m "docs: record real ScoreNow BIB publication"
```
