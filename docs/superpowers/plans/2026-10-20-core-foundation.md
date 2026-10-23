# Core Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve an authorized runner's correct, computed chip recap from a repeatable Supabase dataset before building the visual UI.

**Architecture:** Preserve `/lib` statistics; place verified authentication and ownership checks before a validated server repository and payload composer. The API returns a discriminated Wrapped response and never directly exposes registration or credential data.

**Tech Stack:** Existing Next.js 16, React 19, TypeScript, Supabase Postgres/Auth, Vitest. Retain npm's existing lockfile and add exact dependency versions only after checking current official documentation.

**Spec:** [core-first design proposal](../specs/2026-10-20-core-first-design.md).

**Status:** Execution authorized October 20, 2026; core implementation in progress. Follow the separate roadmap for later integration and UI work. Detailed evidence and remaining acceptance gaps are in [the core verification record](../../qa/core-foundation.md).

## Global Constraints

- Retain one event, 5K/10K, seeded timing, simulated FotoYu, real optional Strava, and free-tier infrastructure.
- Keep `RunnerChipInput` and `WrappedStats` field names.
- Non-finishers have null finish time, pace, ranks and percentile.
- Private responses use `Cache-Control: private, no-store`.
- Browser roles cannot directly select application tables or the Wrapped view in this proposal.
- Keep historical migrations unchanged; implement later changes in new migrations.

## Review Focus

- Runner B requested using runner A's session must return no B data, including cache reuse.
- An existing runner with no chip row must be unavailable, never DNF or a different runner.
- Nonpositive, nonfinite, duplicate or out-of-distance split data must not become plausible insights.
- Changing a peer result must update rankings without rewriting every runner's stored rank.
- Optional photo/Strava failures must leave the chip payload usable and secret-free.

Each condition has explicit coverage in the task that owns the boundary below.

## File responsibilities

| Path | Responsibility |
| --- | --- |
| `lib/supabaseServer.ts` | Lazily initialized server-only privileged client and environment validation |
| `lib/auth/session.ts`, `lib/auth/access.ts` | Verified Supabase session and centralized runner/event authorization |
| `lib/supabaseSession.ts` | Cookie-aware publishable-key SSR client |
| `controllers/runnerController.ts` | Query runner/result/splits, validate and normalize input |
| `lib/runnerValidation.ts` | Pure boundary checks and typed data errors |
| `lib/wrappedPayload.ts`, `lib/merge.ts` | Discriminated payload types and pure optional-data composition |
| `lib/wrappedService.ts` | Authorized core orchestration with existing `buildWrappedStats` |
| `supabase/migrations/<CLI-generated-file>.sql` | Additive hardening, rank view and access mappings; filename generated at execution |
| `db/seed.sql`, `scripts/seed-demo-users.ts` | Repeatable synthetic race fixtures and separate local Auth setup |
| `tests/integration/`, `tests/api/` | Database, authorization and HTTP acceptance evidence |

## Task 1: Make a database-backed baseline reproducible

**Files:** modify `db/seed.sql`, `.env.example`, `lib/supabaseServer.ts`, `db/README.md`, `package.json`; create `tests/integration/database.test.ts`.

**Interfaces:** produces `getSupabaseAdmin(): SupabaseClient`, reads server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; documents publishable-key variables separately. Database fixtures expose bibs `HERO-5K-001`, `HERO-10K-001`, `HERO-10K-002`, `EDGE-DNF`, `EDGE-DNS`, `EDGE-NO-STRAVA`, `EDGE-NO-PHOTOS`, `EDGE-NO-RESULT`. No fixed generated database IDs.

- [ ] Read current Supabase changelog and relevant docs; discover CLI version and `--help` for start, migration creation, reset and linking. Confirm current main, isolation and execution method before editing. Prefer this existing linked worktree; create a branch only under the applicable worktree workflow.
- [ ] Run `npm ci`, `npm test`, `npm run lint`, `npx tsc --noEmit` and record the actual baseline. Validate a production build with test environment configuration. Fix blockers in the task that owns them; do not call a baseline failure a regression.
- [ ] Add an explicitly gated `test:db` command (`vitest run tests/integration`) and write database checks asserting both categories, >=3 full hero fixtures, complete 1..distance splits, non-finisher null fields, one missing result, and repeat-seed row counts unchanged. The integration harness requires a dedicated test URL, refuses nonlocal targets unless explicitly configured, and reports skipped tests as skipped rather than passed.
- [ ] Run `npm run test:db` on a dedicated local database after the existing migration; confirm seed failure before correcting it. If local prerequisites are unavailable, record the blocker and do not substitute an existing cloud database.
- [ ] Replace broken CTEs with a transactional, repeatable seed. Use the Soekarno event date agreed with the team; use August 17, 2027 only as a proposed fixture date matching current test examples, not a historical event claim. Apply 5K minimum age 13, 10K 17 and under-17 parental consent. Include synthetic profiles only, consistent timings and generated photo mappings to actual assets. Existing `/public/photos` assets must be checked before recording URLs.
- [ ] Use `getSupabaseAdmin()` instead of import-time initialization; validate configuration when called, suppress credential details and disable unnecessary session persistence on this privileged client. Align `.env.example` with the exact server variables.
- [ ] Run `npm run test:db` twice across reseeding; expect stable counts and passing consistency assertions. Never execute the destructive cloud reset script.
- [ ] Commit this task's reproducibility changes after checks pass.

## Task 2: Harden schema access and make ranks consistent

**Files:** create one migration through `supabase migration new core_access_and_rank_contract`; modify `docs/data-contract.md`; extend `tests/integration/database.test.ts`.

**Interfaces:** produces server-managed `runner_access(user_id uuid, runner_id uuid)` and `organizer_access(user_id uuid, event_id bigint)` with Auth/domain foreign keys and composite uniqueness; `runner_wrapped` retains existing fields and supplies derived competition ranks under OD-02.

- [ ] Write database assertions for `1,1,3` ties, separate 5K/10K populations, singleton percentile 0, DNF/DNS exclusion and changed-peer reranking. Assert anonymous AND authenticated browser roles cannot query registration tables, splits, access mappings or `runner_wrapped`; service reads still work. Test duplicate BIB, changed assigned BIB, orphan and duplicate-result rejections.
- [ ] Run `npm run test:db`; confirm these assertions fail against the current schema.
- [ ] Add RLS and explicit browser-role revokes to all application tables and the view, including new access tables. Recreate `runner_wrapped` with `security_invoker = true`. Keep service access, and preserve the projection without private registration fields. Use event+distance partition for overall rank and category partition for category rank; percentile remains descending `percent_rank`. Stored rank columns may remain for compatibility, but the view's calculated ranks are authoritative.
- [ ] Add constraint/validation coverage so non-finisher finish fields stay null and finisher timing matches timestamp/distance-derived values. Test SQL null semantics explicitly; a CHECK yielding unknown is not proof of a valid finisher. Preserve existing eligibility and BIB triggers.
- [ ] Apply the migration to the dedicated development database; inspect grants/view options and run `npm run test:db`. Run Supabase advisors where supported, fixing findings introduced by this task. Record any unavailable check.
- [ ] Update the contract with the approved ranking scope and lifecycle distinction; commit the migration, tests and contract together.

## Task 3: Establish verified sessions and runner/event guards

**Files:** create `lib/supabaseSession.ts`, `lib/auth/session.ts`, `lib/auth/access.ts`, `scripts/seed-demo-users.ts`, `tests/auth.test.ts`; modify `.env.example` and dependency lockfile as needed.

**Interfaces:** `requireUser(): Promise<{ id: string }>` verifies server-side Auth identity. `requireRunnerAccess(userId: string, runnerId: string): Promise<void>` allows an explicit runner mapping or organizer mapping to the runner's event. `requireOrganizerAccess(userId: string, eventId: number): Promise<void>` checks the event mapping. Define typed `AuthenticationError` and `AccessDeniedError` here for HTTP mapping.

- [ ] Read current Supabase SSR/Auth documentation. Discover and pin compatible `@supabase/ssr`/`server-only` dependencies if required; use the lockfile rather than unpinned installs.
- [ ] Write `tests/auth.test.ts` for absent/expired sessions, runner A reading A, A reading B, mapped organizer access, organizer for a different event and attempted `user_metadata` role escalation. Assert an unverified session never reaches privileged runner queries.
- [ ] Run `npm test -- tests/auth.test.ts`; expect missing-guard failures.
- [ ] Implement cookie-aware server Auth verification using documented `getUser` behavior. Query access mappings with the admin client after verification. Do not authorize with client-provided user IDs, BIB values or editable metadata. Keep session refresh consistent with current Next.js/Supabase SSR guidance.
- [ ] Add local-only demo-account creation that accepts passwords through environment inputs, links identities to fixture runners and makes one explicitly mapped organizer. No default passwords in source, logs or public UI. Document this separate Auth bootstrap in `db/README.md`.
- [ ] Run auth tests and database grant checks; confirm missing credentials produce controlled failures. Commit this access boundary.

## Task 4: Validate and normalize chip retrieval

**Files:** modify `controllers/runnerController.ts`; create `lib/runnerValidation.ts`, `tests/runnerController.test.ts`.

**Interfaces:** preserve `getRunnerChipInput(runnerId: string): Promise<RunnerChipInput | null>` for successful/missing results; add `getRunnerSummary(runnerId: string): Promise<{ runner_id: string; name: string; bib_number: string | null } | null>`. `validateRunnerChipInput(value: unknown): RunnerChipInput` throws `InvalidRunnerDataError` with no secret payload in the public message.

- [ ] Write tests distinguishing absent runner, missing chip row, valid finisher, DNF and DNS. Numeric-string values normalize to finite numbers; `"NaN"`, zero/negative split seconds, duplicate markers and marker 6 in 5K reject. Non-finishers with non-null finish fields reject. Empty/incomplete splits remain legitimate.
- [ ] Run `npm test -- tests/runnerController.test.ts`; confirm failures against missing validation and current retrieval.
- [ ] Query runner existence separately from the inner-joined view; retrieve ordered splits and whitelist fields. Coerce only known numeric fields with explicit finite/range checks; do not use unsafe type casts as validation. Validate timing consistency with raw chip timestamps, never derive missing finish times from splits.
- [ ] Run controller tests and existing stats tests. Confirm fixture Aina still has 1523 seconds, 304.6 sec/km, fastest km 5 at 290 sec, halves 617/588 and negative split. Commit validated retrieval.

## Task 5: Compose one honest runner payload

**Files:** create `lib/wrappedPayload.ts`, `lib/merge.ts`, `lib/wrappedService.ts`, `tests/wrappedService.test.ts`; preserve `lib/stats.ts` unless a separate demonstrated defect requires a change.

**Interfaces:** export `StravaMetrics`, `Photo`, `WrappedPayload` from the spec. `mergeWrapped(stats: WrappedStats, optional: { strava: WrappedPayloadStrava; photos: Photo[]; warnings: string[] }): WrappedPayload` is pure. `getWrappedForUser(userId: string, runnerId: string): Promise<WrappedPayload | null>` checks access, retrieves/validates input and invokes `buildWrappedStats`. `WrappedPayloadStrava` is the exact state/metrics object from the spec. Until phase 2, return explicit disconnected/no-photo values, not fabricated connections.

- [ ] Write tests using Aina, Citra and Dewa fixtures. Assert computed fastest km/halves/insights, null DNF/DNS finish fields, missing-result unavailable status, unknown runner null and access denial before retrieval. Assert the serialized payload excludes email, phone, ID number, birth date and credential fields.
- [ ] Add optional-data tests: absent Strava yields `disconnected` with null metrics; photo/metrics supplier failure yields a warning and unchanged baseline; another BIB's photo must never be merged. Define supplier seams now so phase 2 can replace defaults without UI changes.
- [ ] Run `npm test -- tests/wrappedService.test.ts`; confirm the new service is absent before implementation.
- [ ] Implement composition using existing statistics helpers, strict lifecycle mapping and explicit optional-data defaults. All provider network refresh stays outside the baseline request. Do not rerank a single runner in JavaScript.
- [ ] Run service tests plus the full existing unit suite; commit the computed payload boundary.

## Task 6: Expose the computed, protected API

**Files:** modify `app/api/runners/[runnerId]/wrapped/route.ts`; create `tests/api/wrapped.test.ts`.

**Interfaces:** `GET /api/runners/:runnerId/wrapped` returns 200 with `WrappedPayload`, including a known runner's unavailable state; 400 invalid UUID; 401 absent session; 404 missing/forbidden runner; 422 invalid stored data; 503 required database unavailable. Every response is JSON and private/no-store. Optional failures stay 200 with warnings.

- [ ] Write handler tests asserting exact statuses/content-type/cache headers, Aina's computed stats, no private fields and no DB queries for malformed IDs or unauthenticated requests. Verify requests for A then B cannot reuse A's response; denied IDs reveal neither runner summary nor existence.
- [ ] Run `npm test -- tests/api/wrapped.test.ts`; expect failures against the current input-only handler.
- [ ] Compose `requireUser()` and `getWrappedForUser()`; map typed errors to stable public messages and redact server errors. Keep asynchronous Next.js route params. Use `Response.json`; never serialize privileged error objects.
- [ ] Run API tests, `npm test`, `npm run lint`, `npx tsc --noEmit` and `npm run build` with a controlled test environment. Record actual results and commit the route integration.

## Task 7: Prove the core against a real dedicated database

**Files:** create `tests/integration/wrapped-flow.test.ts`, `docs/qa/core-foundation.md`; update `docs/requirements-register.md` with actual evidence links only.

**Interfaces:** consumes Tasks 1–6; produces a reproducible core acceptance record and a payload fixture for UI/integration development.

- [ ] Seed the dedicated database, bootstrap test Auth users and exercise HTTP requests with real sessions for A, B and the organizer. Assert A can read A, cannot read B; an existing missing-result fixture is unavailable; DNF/DNS contain no finish values; anonymous direct database access fails. Integration tests must use their dedicated config and clean up only records they created.
- [ ] Change a peer's result in a rollback-isolated test and assert refreshed ranks follow OD-02, proving the view is not returning stale stored ranks. Force split-source failure and verify a controlled required-data error. Optional enrichment failures remain nonblocking.
- [ ] Run unit/API/database suites and production build. Record test counts, skip counts, environment, fixtures and output in `docs/qa/core-foundation.md`. An unavailable database leaves this gate incomplete even if unit tests pass.
- [ ] Recheck remote main and the diff. Review for server-key exposure, view grants, identity mixing, stale caches and requirement coverage. Resolve material findings before moving to later core subsystems.
- [ ] Commit evidence and hand off to phase 2. Core approval does not establish full SRS completion or visual/export acceptance.

## Provisioning checkpoint

Resolved: the user selected **buns project** (`qltvdxsrkupbgplgmhxg`) and approved $0/month. **marathon-wrapped** (`anbnuegocddoowagqmxw`) is healthy in Singapore. Public schema was verified empty before applying the initial and follow-up migrations; seed/database assertions ran on this dedicated project. No unrelated project was changed. MCP-generated migration versions were reconciled to the exact local filenames after verifying names and successfully applied SQL, so future CLI pushes will not reapply those migrations. Do not copy credentials into this plan.

## Self-review and execution handoff

Checked the draft against the design: every core boundary has a task; later Strava/FotoYu/organizer/UI obligations are explicitly assigned in the delivery roadmap. Review Focus cases map to Tasks 2–6 and real-database verification. No task assumes a new cloud project already exists or a Figma screenshot was inspected.

Recommended execution: **inline**, using `superpowers:executing-plans`, because these tasks share database and response interfaces and the user wants the core built first. Delegated implementation is an available alternative if the user chooses it. Review the design and plan before execution; resolve OD-02/OD-04 in particular rather than silently treating proposals as approved.
