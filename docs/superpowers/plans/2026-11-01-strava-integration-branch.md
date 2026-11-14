# Strava Integration Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create an isolated `integration` branch from `origin/dev`, merge `origin/strava-integration` without changing either source branch, and complete real Strava OAuth, race matching, metrics, recap UI, and disconnection acceptance.

**Architecture:** Preserve the Strava branch's encrypted OAuth, webhook, durable job, refresh, and revocation foundations, then add runner-bound attempts, category race configuration, server-owned candidates, explicit confirmation, live-metric materialization, and refreshed UI states. Ordinary recap reads remain Supabase-only; provider traffic runs only during OAuth or authenticated worker processing, so Strava failure cannot block chip results, photos, or export.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase/Postgres, Vitest, Node test runner, Strava V3 API.

**Spec:** `docs/superpowers/specs/2026-11-01-strava-integration-branch-design.md`

## Global Constraints

- `integration` starts at the current `origin/dev` tip and merges the current `origin/strava-integration` tip with a two-parent `--no-ff` merge commit.
- Never rewrite, reset, delete, force-push, or commit directly to `dev` or `strava-integration`.
- Work only in a new isolated managed worktree; refuse to overwrite an existing `integration` ref or worktree.
- OAuth starts only after an authenticated runner explicitly selects Connect.
- Chip results, photos, recap navigation, and PNG export remain usable during every Strava state and error.
- Store secrets and provider credentials server-side only; access tokens and refresh tokens remain encrypted at rest.
- Match only `Run` activities, use a ±500 m distance tolerance, and require confirmation whenever GPS/start configuration is incomplete or more than one candidate is plausible.
- Do not commit private activity identifiers, private coordinates, real tokens, or QA credentials.
- Preserve demo metrics separately and label them as samples; live values win only while a live selection is active.
- Preserve Strava's raw `average_cadence`; label it “Strava cadence” rather than inventing an `spm` conversion.

## Review Focus

- A user mapped to multiple runners must not connect or confirm an activity for the wrong runner; Task 4 binds and tests `runner_id` in the OAuth attempt, and Task 7 rechecks ownership on confirmation.
- Duplicate callbacks, webhook deliveries, worker retries, and confirmation requests must remain idempotent; Tasks 4, 6, and 7 add replay tests.
- Missing GPS, missing start coordinates, multiple plausible activities, and zero matches must never silently attach the wrong activity; Tasks 3 and 6 exercise each state.
- Refresh races and disconnect races must never restore ingestion or metrics after local disconnection; Tasks 6 and 8 add lifecycle regressions.
- Partial or malformed provider metrics must not invent values or break the baseline recap; Tasks 5 and 8 cover normalization and UI fallback.

---

### Task 1: Create the isolated integration environment

**Files:**
- Add after workspace creation: `docs/superpowers/specs/2026-11-01-strava-integration-branch-design.md`
- Add after workspace creation: `docs/superpowers/plans/2026-11-01-strava-integration-branch.md`

**Interfaces:**
- Consumes: remote refs `origin/dev` and `origin/strava-integration`.
- Produces: an isolated worktree on local branch `integration`, initially identical to `origin/dev`.

- [ ] **Step 1: Verify source refs and refuse destructive reuse**

Run:

```powershell
git fetch --all
git show-ref --verify refs/remotes/origin/dev
git show-ref --verify refs/remotes/origin/strava-integration
git show-ref --verify refs/heads/integration
git worktree list --porcelain
```

Expected: both remote refs resolve; local `integration` does not resolve. If it exists, stop and inspect it instead of resetting or deleting it.

- [ ] **Step 2: Create the managed worktree at `origin/dev`**

Use the Codex native worktree creation tool with `ref: origin/dev`, then attach it if registration does not complete automatically. In that worktree run:

```powershell
git switch -c integration
git status --short --branch
```

Expected: `## integration` with no changes.

- [ ] **Step 3: Establish the dev baseline**

Run:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run test:native
npm run lint
npx tsc --noEmit
npm run build
```

Expected: all non-live tests, lint, type-check, and build pass. Record exact test counts. Stop for investigation if the unmerged `dev` baseline fails.

- [ ] **Step 4: copy the approved spec and plan into the integration worktree**

Use `apply_patch` in the new worktree to add these two documents with the exact approved contents from the planning worktree.

- [ ] **Step 5: Commit the execution contract**

```powershell
git add docs/superpowers/specs/2026-11-01-strava-integration-branch-design.md docs/superpowers/plans/2026-11-01-strava-integration-branch.md
git commit -m "docs: define Strava integration workflow"
```

### Task 2: Merge and stabilize the preserved Strava branch

**Files:**
- Merge/resolve: `README.md`
- Merge/resolve: `app/api/strava/connect/route.ts`
- Merge/resolve: `app/api/strava/disconnect/route.ts`
- Merge/resolve: `app/components/RecapStory.tsx`
- Merge/resolve: `controllers/enrichmentController.ts`
- Merge/resolve: `lib/wrappedPayload.ts`
- Merge/add: `lib/strava/*.ts`
- Merge/add: `app/api/internal/strava/process/route.ts`
- Merge/add: `app/api/strava/callback/route.ts`
- Merge/add: `app/api/strava/webhook/route.ts`
- Merge/add: `app/api/runners/[runnerId]/strava/route/route.ts`
- Merge/add: `supabase/migrations/20261026175630_strava_integration.sql`
- Merge/add: `supabase/migrations/20261028192351_strava_lifecycle.sql`
- Merge/add: `tests/api/strava.test.ts`
- Merge/add: `tests/stravaClient.test.ts`
- Merge/add: `tests/stravaProcessing.test.ts`
- Merge/add: `tests/stravaMatching.test.ts`
- Merge/add: `tests/integration/strava-lifecycle.test.ts`
- Merge/add: `tests/native/strava-database.test.mts`
- Merge/add: `tests/sql/strava-lifecycle.sql`

**Interfaces:**
- Consumes: clean `integration` branch from Task 1 and `origin/strava-integration`.
- Produces: one merge commit containing both histories and a compiling, testable combined tree; incomplete matching remains explicitly covered by TODO/failing tests until later tasks.

- [ ] **Step 1: Start a non-squashed merge without committing**

```powershell
git merge --no-ff --no-commit origin/strava-integration
git status --short
```

Expected: revert-derived conflicts or modify/delete cases are visible and limited to the combined tree; neither source ref moves.

- [ ] **Step 2: Resolve files according to the design conflict policy**

Keep `dev` for the refreshed recap, login, registration, decorations, export, and shared non-Strava behavior. Keep the Strava source versions under `lib/strava`, Strava routes, lifecycle migrations, and Strava tests. Manually compose README, payload, enrichment, and recap changes; do not use blanket “ours” or “theirs” across the repository.

- [ ] **Step 3: Add a merge smoke assertion**

Extend `tests/wrappedService.test.ts` with a test named `keeps the chip recap usable when Strava enrichment is unavailable`. Assert that an enrichment error returns baseline stats plus a warning instead of rejecting the Wrapped response.

- [ ] **Step 4: Run the merge gate**

```powershell
npm test
npm run test:native
npm run lint
npx tsc --noEmit
npm run build
```

Expected: all existing runnable tests pass; `tests/stravaMatching.test.ts` may still contain only the known TODO, but no new skipped test is permitted.

- [ ] **Step 5: Commit the true merge**

```powershell
git add -A
git commit -m "merge: combine dev and Strava integration"
git rev-list --parents -n 1 HEAD
git merge-base --is-ancestor origin/dev HEAD
git merge-base --is-ancestor origin/strava-integration HEAD
```

Expected: the merge commit has two parents and both ancestry checks exit 0.

### Task 3: Add race configuration and candidate persistence

**Files:**
- Create: `supabase/migrations/20261101000100_strava_race_matching.sql`
- Modify: `tests/sql/strava-lifecycle.sql`
- Modify: `tests/native/strava-database.test.mts`
- Modify: `tests/integration/strava-lifecycle.test.ts`
- Modify: `db/README.md`

**Interfaces:**
- Consumes: existing `strava_connections`, `strava_oauth_attempts`, `strava_jobs`, `strava_activities`, runner/category schema, and `runner_access`.
- Produces: `strava_race_configs`, `strava_activity_candidates`, `strava_runner_activities`, `strava_live_metrics`, and security-definer RPCs used by Tasks 4, 6, and 7.

- [ ] **Step 1: Write failing SQL assertions**

Add rollback-wrapped assertions for:

- one configuration per category with `Run`, 500 m tolerance, valid UTC window, and nullable coordinate/radius trio;
- rejection of invalid windows, partial coordinates, negative radius, non-500 tolerance, and empty sport types;
- candidate uniqueness by connection generation, runner, and activity;
- at most one selected activity and one live metric row per runner;
- runner/user ownership and foreign-key rejection;
- atomic selection replacing previous live metrics;
- repeated selection being idempotent;
- disconnect cleanup removing selection/live metrics while leaving demo `strava_metrics` untouched.

- [ ] **Step 2: Run the database test to verify failure**

Run the optional PGlite test with `STRAVA_PGLITE_MODULE` configured, or the dedicated-project test with `RUN_STRAVA_DATABASE_TESTS=1`.

Expected: FAIL because the matching tables/RPCs do not exist.

- [ ] **Step 3: Implement the additive migration**

Create the four tables and these RPC boundaries:

```ts
strava_begin_runner_oauth(p_user, p_runner, p_hash, p_return_path) -> text
strava_claim_runner_oauth(p_user, p_hash) -> jsonb
strava_store_runner_candidates(p_user, p_generation, p_runner, p_candidates) -> void
strava_select_runner_activity(p_user, p_generation, p_runner, p_activity, p_metrics) -> text
strava_clear_live_selection(p_user, p_generation) -> void
```

The claim JSON contains only `{ status, runner_id, return_path, generation }`; it never contains credentials. Use distinct RPC names instead of overloading the source migration's signatures so Supabase RPC resolution remains unambiguous.

Bind `runner_id` and a validated local return path to each OAuth attempt. Revoke all table access and RPC execution from `public`, `anon`, and `authenticated`; grant only `service_role`, following the existing server-only model.

- [ ] **Step 4: Run database tests to green**

Expected: lifecycle, ownership, replay, replacement, and cleanup assertions pass and roll back.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/20261101000100_strava_race_matching.sql tests/sql/strava-lifecycle.sql tests/native/strava-database.test.mts tests/integration/strava-lifecycle.test.ts db/README.md
git commit -m "feat: add Strava race matching storage"
```

### Task 4: Finish deterministic race matching

**Files:**
- Modify: `lib/strava/matching.ts`
- Modify: `tests/stravaMatching.test.ts`

**Interfaces:**
- Consumes: `StravaActivity` from `lib/strava/client.ts` and category configuration from Task 3.
- Produces: `validateRaceMatchConfig(config): RaceMatchConfig` and `matchActivityToRace(activity, config): ActivityMatchResult` where status is `auto_match`, `needs_confirmation`, or `no_match` with a stable reason code.

- [ ] **Step 1: Replace the TODO with failing table-driven tests**

Cover exact window boundaries, ±500 m distance boundaries, `Run` versus other sport types, invalid timestamps/distances/coordinates, Haversine inside/outside radius, missing activity GPS, missing configured location, and all invalid configuration combinations. Assert that missing location/GPS returns `needs_confirmation`, never `auto_match`.

- [ ] **Step 2: Run the focused test and observe failure**

```powershell
npx vitest run tests/stravaMatching.test.ts
```

Expected: FAIL against the provisional function and TODO implementation.

- [ ] **Step 3: Implement pure validation and matching**

Use UTC instants, category distance, fixed 500 m tolerance, allowed type `Run`, and a Haversine calculation in meters. Validate all numeric inputs before comparing them. Do not call the database or provider.

- [ ] **Step 4: Run focused and client tests**

```powershell
npx vitest run tests/stravaMatching.test.ts tests/stravaClient.test.ts
```

Expected: PASS with no TODOs.

- [ ] **Step 5: Commit**

```powershell
git add lib/strava/matching.ts tests/stravaMatching.test.ts
git commit -m "feat: match Strava activities to race configuration"
```

### Task 5: Bind OAuth to the selected runner and return path

**Files:**
- Modify: `lib/strava/oauth.ts`
- Modify: `app/api/strava/connect/route.ts`
- Modify: `app/api/strava/callback/route.ts`
- Modify: `lib/strava/http.ts`
- Modify: `tests/api/strava.test.ts`

**Interfaces:**
- Consumes: Task 3's runner-bound OAuth RPC and existing `requireUser`/`requireRunnerAccess` guards.
- Produces: `connectStrava(request)` that accepts form field `runnerId`; `finishStravaAuthorization(request)` that resumes only the stored runner and returns to `/wrapped/{runnerId}` with a safe outcome code.

- [ ] **Step 1: Write failing runner-binding tests**

Add cases for an authorized runner, a foreign runner, malformed runner ID, user owning two runners, replayed callback, callback in another browser, external return path, provider denial, partial scopes, and repeated successful callback. Assert that storage receives the selected `runner_id` and only a server-generated local return path.

- [ ] **Step 2: Run the focused tests and observe failure**

```powershell
npx vitest run tests/api/strava.test.ts
```

Expected: the new runner-binding assertions fail.

- [ ] **Step 3: Implement the minimal OAuth binding**

Validate `runnerId`, require current-user access before creating state, store the runner and return path in the OAuth attempt, and read them back from the claimed attempt rather than trusting callback parameters. Preserve encrypted tokens, cookie binding, scope checks, athlete arbitration, and retry rules from the source branch.

- [ ] **Step 4: Run OAuth, auth, and wrapped tests**

```powershell
npx vitest run tests/api/strava.test.ts tests/auth.test.ts tests/api/wrapped.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/strava/oauth.ts lib/strava/http.ts app/api/strava/connect/route.ts app/api/strava/callback/route.ts tests/api/strava.test.ts
git commit -m "feat: bind Strava OAuth to an authorized runner"
```

### Task 6: Normalize detailed activity metrics safely

**Files:**
- Modify: `lib/strava/client.ts`
- Modify: `tests/stravaClient.test.ts`

**Interfaces:**
- Consumes: Strava DetailedActivity responses.
- Produces: `StravaActivity` extended with nullable `averageHeartrate`, `maxHeartrate`, `elevationGainMeters`, `calories`, and `averageCadence`; invalid present values reject the provider response, absent values remain null.

- [ ] **Step 1: Write failing provider-normalization tests**

Assert complete metrics, each missing metric independently, zero values, negative/nonfinite/wrong-type rejection, foreign athlete rejection, malformed coordinates, and raw cadence preservation without doubling.

- [ ] **Step 2: Run the focused test and observe failure**

```powershell
npx vitest run tests/stravaClient.test.ts
```

- [ ] **Step 3: Extend `normalizeActivity`**

Map Strava fields `average_heartrate`, `max_heartrate`, `total_elevation_gain`, `calories`, and `average_cadence` into the nullable internal fields. Do not expose tokens, route polyline, or full provider payload through runner-facing types.

- [ ] **Step 4: Run focused tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/strava/client.ts tests/stravaClient.test.ts
git commit -m "feat: normalize Strava race metrics"
```

### Task 7: Connect workers to candidates, selection, and live metrics

**Files:**
- Modify: `lib/strava/processing.ts`
- Modify: `lib/strava/store.ts`
- Modify: `tests/stravaProcessing.test.ts`
- Modify: `tests/integration/strava-lifecycle.test.ts`

**Interfaces:**
- Consumes: Task 3 RPCs, Task 4 matching results, Task 5 runner-bound attempt, and Task 6 normalized metrics.
- Produces: `enqueueRunnerStravaBackfill(userId, runnerId)`, candidate persistence, zero/ambiguous/single-match resolution, idempotent selection, and disconnect cleanup.

- [ ] **Step 1: Write failing processing tests**

Cover one full-GPS match auto-selecting; one missing-GPS match requiring confirmation; two qualifying activities requiring confirmation; zero matches; wrong sport/window/distance; stale generation; duplicate webhook; repeated backfill page; partial metrics; rate-limit retry; refresh failure; disconnect winning a worker race; and preservation of demo metrics.

- [ ] **Step 2: Run focused tests and observe failure**

```powershell
npx vitest run tests/stravaProcessing.test.ts
```

- [ ] **Step 3: Implement runner-scoped discovery and selection**

Load the runner's category configuration server-side. Queue the configured window after successful OAuth. Fetch detail records through the existing queue, classify them with `matchActivityToRace`, persist candidate summaries without polyline, auto-select only one complete match, and materialize only Task 6's five metrics in `strava_live_metrics`.

- [ ] **Step 4: Implement disconnect cleanup ordering**

Commit local disconnection and clear live selection/metrics before attempting remote revocation. Keep the existing durable revoke retry and prevent stale jobs from repopulating cleared data.

- [ ] **Step 5: Run processing and live lifecycle tests**

```powershell
npx vitest run tests/stravaProcessing.test.ts tests/api/strava.test.ts
npm run test:db
```

Expected: unit tests pass; the live suite passes when its dedicated Supabase environment is configured. Never point it at production.

- [ ] **Step 6: Commit**

```powershell
git add lib/strava/processing.ts lib/strava/store.ts tests/stravaProcessing.test.ts tests/integration/strava-lifecycle.test.ts
git commit -m "feat: process and select Strava race activities"
```

### Task 8: Finish runner-facing Strava API states and confirmation

**Files:**
- Modify: `app/api/runners/[runnerId]/strava/route/route.ts`
- Modify: `app/api/strava/disconnect/route.ts`
- Modify: `lib/strava/processing.ts`
- Create: `tests/api/runnerStrava.test.ts`

**Interfaces:**
- Consumes: Task 7 candidate/selection services and existing same-origin/auth guards.
- Produces: `GET /api/runners/{runnerId}/strava` returning safe state/candidate summaries; `PUT` accepting `{ activityId: string }`; disconnect statuses `disconnected`, `disconnecting`, or `reauthorize_to_disconnect`.

- [ ] **Step 1: Write failing API tests**

Cover unauthorized/foreign runner, disconnected, importing, no match, one auto-match, ambiguous candidates, missing-GPS confirmation, stale/foreign/unknown activity confirmation, repeated confirmation, cross-origin PUT, partial metrics, and each disconnect outcome. Assert no polyline, tokens, raw payload, or private coordinates appear.

- [ ] **Step 2: Run the focused API test and observe failure**

```powershell
npx vitest run tests/api/runnerStrava.test.ts
```

- [ ] **Step 3: Replace the HTTP 501 confirmation stub**

Implement `confirmRunnerStravaActivity(userId, runnerId, activityId)` with access, candidate ownership, generation, and current-connection checks before invoking the atomic selection RPC.

- [ ] **Step 4: Implement safe response mapping**

Return only activity ID, local start time, distance, sport label, GPS-available boolean, match reason, state, and available metrics. Apply private/no-store headers to all responses.

- [ ] **Step 5: Run API and security tests**

```powershell
npx vitest run tests/api/runnerStrava.test.ts tests/api/strava.test.ts tests/auth.test.ts
```

Expected: PASS; repository search finds no runner-facing token/polyline serialization.

- [ ] **Step 6: Commit**

```powershell
git add app/api/runners/[runnerId]/strava/route/route.ts app/api/strava/disconnect/route.ts lib/strava/processing.ts tests/api/runnerStrava.test.ts
git commit -m "feat: expose safe Strava selection workflow"
```

### Task 9: Integrate live Strava state into Wrapped and the refreshed UI

**Files:**
- Modify: `lib/wrappedPayload.ts`
- Modify: `controllers/enrichmentController.ts`
- Modify: `app/components/RecapStory.tsx`
- Create: `app/components/StravaCard.tsx`
- Modify: `app/globals.css`
- Create: `lib/strava/viewModel.ts`
- Modify: `tests/wrappedService.test.ts`
- Modify: `tests/api/wrapped.test.ts`
- Create: `tests/stravaViewModel.test.ts`

**Interfaces:**
- Consumes: Task 8 API states and `strava_live_metrics`; preserves existing `WrappedPayload` chip/photo contracts.
- Produces: expanded `WrappedPayloadStrava` states and a bounded `StravaCard` UI for connect, importing, confirmation, metrics, failure, and disconnect.

- [ ] **Step 1: Write failing payload-priority tests**

Assert live metrics override demo metrics only while selected; disconnect restores labeled demo values; provider/storage failure returns `unavailable` plus a warning; absent data returns `disconnected`; partial metrics remain partial; chip stats and export model stay unchanged.

- [ ] **Step 2: Run payload tests and observe failure**

```powershell
npx vitest run tests/wrappedService.test.ts tests/api/wrapped.test.ts
```

- [ ] **Step 3: Implement enrichment priority and states**

Query `strava_live_metrics` and existing demo `strava_metrics` independently under the existing optional-data deadline. Add states: `disconnected`, `authorizing`, `importing`, `needs_confirmation`, `no_match`, `connected`, `unavailable`, `disconnecting`, `reauthorize_required`, and `demo`.

- [ ] **Step 4: Write failing UI state tests**

Pin readable copy and enabled actions for every state. Assert Connect is an explicit POST action, confirmation names date/distance without private route data, disconnect requires an explicit action, baseline navigation remains present, live cadence is not labeled `spm`, and callback feedback is removed from the URL after display.

- [ ] **Step 5: Implement `StravaCard` and wire it into the refreshed recap**

Keep the `dev` layout/decorations. Use accessible buttons, status text, focus handling, disabled pending actions, same-origin requests, and existing red/cream/lime tokens. Do not alter PNG export to include health metrics.

- [ ] **Step 6: Run UI, recap, export, and responsive regression tests**

```powershell
npx vitest run tests/wrappedService.test.ts tests/api/wrapped.test.ts tests/exportWrapped.test.ts tests/recapDecorations.test.ts tests/stravaViewModel.test.ts
npm run lint
npx tsc --noEmit
```

Expected: PASS. `viewModel.ts` remains DOM-free because the repository's Vitest configuration uses the Node environment.

- [ ] **Step 7: Commit**

```powershell
git add lib/wrappedPayload.ts lib/strava/viewModel.ts controllers/enrichmentController.ts app/components/RecapStory.tsx app/components/StravaCard.tsx app/globals.css tests/wrappedService.test.ts tests/api/wrapped.test.ts tests/stravaViewModel.test.ts
git commit -m "feat: add Strava controls to the refreshed recap"
```

### Task 10: Document configuration and reconcile product requirements

**Files:**
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `docs/SRS_v4.md`
- Modify: `docs/requirements-register.md`
- Modify: `docs/qa/acceptance-matrix.md`
- Create: `docs/qa/strava-integration.md`
- Modify: `.env.example` only if the repository policy now permits a names-only template; otherwise document names in README without creating it.

**Interfaces:**
- Consumes: completed behavior from Tasks 3–9.
- Produces: one consistent setup/requirements/acceptance story and a safe live-test runbook.

- [ ] **Step 1: Update requirements status without overstating acceptance**

Mark FR-08–FR-11 implemented only where automated evidence exists. Keep live provider acceptance pending until Task 11. Reconcile the old “no Strava application exists” decision with the newly approved full-integration direction and record the date/change rationale.

- [ ] **Step 2: Document exact server-only configuration**

Document `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_CALLBACK_URL`, `STRAVA_ENCRYPTION_KEY`, `STRAVA_WEBHOOK_VERIFY_TOKEN`, `STRAVA_SUBSCRIPTION_ID`, and `STRAVA_PROCESS_SECRET`; include callback URL, webhook registration, scheduler call, key-rotation warning, dedicated-test database rule, and disconnect cleanup behavior. Never include values.

- [ ] **Step 3: Document race configuration and QA override**

Explain category windows, `Run`, ±500 m, nullable coordinates, confirmation rules, and the temporary QA-only window. Require restoration after testing and prohibit committing private coordinates/activity IDs.

- [ ] **Step 4: Commit**

```powershell
git add README.md PRODUCT.md docs/SRS_v4.md docs/requirements-register.md docs/qa/acceptance-matrix.md docs/qa/strava-integration.md
git commit -m "docs: align requirements with live Strava integration"
```

### Task 11: Run full automated and live acceptance gates

**Files:**
- Update with results: `docs/qa/strava-integration.md`
- Update with final status: `docs/qa/acceptance-matrix.md`

**Interfaces:**
- Consumes: complete `integration` branch plus separately supplied Strava app and dedicated Supabase test credentials.
- Produces: reproducible evidence for automated correctness and real-provider behavior; does not deploy or merge to another branch.

- [ ] **Step 1: Run the complete local gate**

```powershell
npm test
npm run test:native
npm run lint
npx tsc --noEmit
npm run build
git status --short
```

Expected: all runnable tests pass, no TODO matching test remains, build succeeds, and only intentional QA-document edits are present.

- [ ] **Step 2: Run isolated database gates**

Run the native PGlite migration suite and `npm run test:db` against the dedicated non-production Supabase project. Expected: schema, ownership, lifecycle, retry, replay, matching, selection, and cleanup tests pass and disposable fixtures are removed.

- [ ] **Step 3: Run controlled-provider fixture tests**

Exercise mocked HTTP sequences for consent success/denial, partial scope, complete/partial activity metrics, no match, ambiguity, missing GPS, 429 with `Retry-After`, refresh, provider revocation, and disconnect cleanup.

- [ ] **Step 4: Run manual Strava sandbox acceptance**

Using user-supplied credentials and a private test account, temporarily configure a QA-only window around a private test `Run`. Verify explicit connect, provider denial fallback, import, confirmation where required, live metrics, refresh persistence, disconnect, baseline preservation, and removal of live metrics. Restore the Soekarno Run configuration immediately afterward.

- [ ] **Step 5: Run browser and privacy acceptance**

Check desktop and mobile viewports, keyboard/focus behavior, callback feedback cleanup, no duplicate recap/provider calls, unchanged 1080 × 1350 export, no health metrics in export, and absence of tokens/secrets/private route geometry in HTML, JSON, logs, and repository diffs.

- [ ] **Step 6: Record truthful evidence**

Write environment, commands, counts, outcomes, skipped external gates, and remaining limitations in `docs/qa/strava-integration.md`; update the acceptance matrix only for completed evidence.

- [ ] **Step 7: Commit acceptance evidence**

```powershell
git add docs/qa/strava-integration.md docs/qa/acceptance-matrix.md
git commit -m "test: record Strava integration acceptance"
```

- [ ] **Step 8: Verify source-branch preservation and final ancestry**

```powershell
git merge-base --is-ancestor origin/dev integration
git merge-base --is-ancestor origin/strava-integration integration
git log --graph --decorate --oneline origin/dev origin/strava-integration integration -n 40
git diff --check origin/dev...integration
git status --short --branch
```

Expected: both ancestry checks pass, source refs still point to their original fetched commits, the integration worktree is clean, and no whitespace errors remain.

## Execution Order and Review Gates

Execute strictly in task order. After each task, review only that task's commit and rerun its focused tests before continuing. Do not push, deploy, apply remote migrations, register a webhook, or merge `integration` into another branch unless the user separately authorizes that external change.
