# Strava integration setup and acceptance runbook

Updated November 3, 2026. This runbook separates repeatable local evidence from credential-gated external acceptance. It does not authorize deployment, remote migrations, webhook registration, or provider calls.

## Current evidence status

| Gate | Current evidence | Acceptance status |
| --- | --- | --- |
| Unit, route, service, UI-model, privacy, and export tests | Final fix wave: 328 passed, 17 environment-gated skips | Automated local evidence passed |
| Local PostgreSQL migration/lifecycle/worker/confirmation checks | Task 11 default run: 10 passed, 1 gated skip; activated PGlite run: 11 passed | Automated local PostgreSQL evidence passed |
| Dedicated Supabase concurrency suite | Not run; no dedicated-project credentials were supplied | Pending |
| Real Strava OAuth, import, webhook, refresh, and revocation | Not run; no test application/account credentials were supplied | Pending |
| Desktop/mobile, keyboard/focus, callback URL cleanup, and PNG privacy | Automated/static coverage exists; complete manual pass not run for this integration | Pending |

No full FR-08–FR-11 acceptance is claimed until every applicable pending gate is recorded below.

## Final fix verification — November 3, 2026

The final review fixes enforce the completed OAuth attempt's runner/generation throughout discovery, detail processing, candidate writes, selection, and API reads. Rejected or unconfigured activities do not retain health/location snapshots. Missing Strava setup or storage errors from a native Connect form return to the validated recap with safe feedback. Organizer denial combined with sample-query failure hides all mutation controls.

| Gate | Command / check | Observed result |
| --- | --- | --- |
| Full suite | `npm test` | 23 files passed, 2 credential-gated files skipped; 328 tests passed, 17 skipped, 0 failed |
| Controlled-provider/regression fixtures | Same seven-file focused command recorded below | 240 passed, 0 failed |
| Export/privacy subset | Same six-file subset command recorded below | 111 passed, 0 failed |
| Native default | `npm run test:native` | 10 passed, 1 PGlite-gated skip |
| Activated PostgreSQL | Set `STRAVA_PGLITE_MODULE` to the established external module, then `npm run test:native` | 11 passed, 0 skipped; includes pre-fix upgrade cleanup, two-runner scope, stale generations, rollback, snapshot invalidation, idempotent scoped pages, and privilege assertions |
| Static gates | `npm run lint`; `npx tsc --noEmit`; `npm run build` | Passed; production build generated 15 static pages |
| Branch-wide whitespace | `git diff --check origin/dev...integration` | Passed after removing both plan/spec EOF blank lines |
| Source histories | Both ancestry commands and source-ref comparisons below | Passed; both source refs unchanged |

The same credentialed and manual gates remain pending. Existing non-failing Vite CJS and native typeless-package warnings remain; no dependency versions or lockfiles changed.

## Task 11 evidence — November 2, 2026

Environment: Windows/PowerShell in the isolated `integration` worktree, Node.js test runner, Vitest 2.1.9, Next.js 16.3.6, and an external PGlite module outside the repository. No `.env.local` or `.env.demo.local` file was present, and none of the required Strava or dedicated-Supabase variables was set. No credential value was read or recorded.

| Gate | Command / check | Observed result |
| --- | --- | --- |
| Full unit/API/service suite | `npm test` | 23 files passed, 2 credential-gated files skipped; 313 tests passed, 17 skipped, 0 failed |
| Native default | `npm run test:native` | 10 passed, 1 PGlite-gated skip, 0 failed |
| Native with isolated PostgreSQL | Set `STRAVA_PGLITE_MODULE` to the established external module, then `npm run test:native` | 11 passed, 0 skipped, 0 failed; migration/lifecycle suite completed in PGlite |
| Controlled-provider fixtures | `npx vitest run tests/api/strava.test.ts tests/api/runnerStrava.test.ts tests/stravaClient.test.ts tests/stravaProcessing.test.ts tests/stravaMatching.test.ts tests/wrappedService.test.ts tests/stravaViewModel.test.ts` | 7 files and 225 tests passed |
| Export/privacy subset | `npx vitest run tests/exportWrapped.test.ts tests/shareModel.test.ts tests/api/wrapped.test.ts tests/wrappedService.test.ts tests/stravaViewModel.test.ts tests/api/runnerStrava.test.ts` | 6 files and 106 tests passed |
| Static quality | `npm run lint`; `npx tsc --noEmit`; `npm run build` | All passed; production build compiled and generated 15 static pages |
| Current-worktree whitespace | `git diff --check` | Passed |
| Branch ancestry | `git merge-base --is-ancestor origin/dev integration`; same for `origin/strava-integration` | Both exited 0 |
| Source-ref preservation | Compare current refs with the Task 1 recorded SHAs | `origin/dev` remains `d82a4fa77a55dfea8891433546df2234b1f7ed0f`; `origin/strava-integration` remains `b782a0cda5cea71031e7cb8ceda18830ed87ba25` |
| Branch-wide whitespace | `git diff --check origin/dev...integration` | Task 11 found an extra EOF blank line in the plan/spec copies; the final fix wave removed both. See the final verification below. |

Controlled fixtures exercised consent success and denial, partial scope, complete/partial/malformed metrics, zero/no/ambiguous matching, missing GPS, `429` with `Retry-After`, coordinated refresh, provider revocation, repeat/replay protection, and disconnect cleanup. The evidence is in `tests/api/strava.test.ts`, `tests/api/runnerStrava.test.ts`, `tests/stravaClient.test.ts`, `tests/stravaProcessing.test.ts`, `tests/stravaMatching.test.ts`, and the activated native lifecycle suite.

Static and automated privacy evidence confirms one recap fetch on component load, ordinary recap reads use stored data rather than Strava, callback feedback is allowlisted and removed with `history.replaceState`, and candidates omit athlete IDs, credentials, raw payloads, coordinates, and route geometry. The owner-authorized candidate API intentionally returns the provider `activityId` needed for explicit confirmation. Organizer-only viewers receive no live metrics or controls, export remains 1080 × 1350, and the share/export model receives no health metrics. The production build confirms the code compiles, but no usable local authenticated runner fixture exists without the absent Supabase configuration; desktop/mobile visual layout, keyboard/focus transitions, address-bar observation, browser network/storage/log inspection, and a rendered PNG inspection therefore remain pending manual browser acceptance.

Skipped external gates:

- `npm run test:db` was not run because no dedicated non-production Supabase URL, matching project ref, or service credential was configured. The hostname guard was not bypassed.
- Manual Strava OAuth/import/webhook/refresh/revocation was not run because no test application credentials or private test account was supplied. No live provider endpoint was called.
- No remote migration, webhook registration, scheduler configuration, deployment, push, or merge to another branch was performed.

## Server-only configuration

Keep values in ignored environment files or the deployment secret store. Never expose these names through `NEXT_PUBLIC_*`, print their values, or commit an environment file.

| Variable | Purpose |
| --- | --- |
| `STRAVA_CLIENT_ID` | Strava application client ID |
| `STRAVA_CLIENT_SECRET` | Strava application client secret |
| `STRAVA_CALLBACK_URL` | Exact callback URL, ending in `/api/strava/callback`; HTTPS is required except HTTP on localhost in development |
| `STRAVA_ENCRYPTION_KEY` | 32 random bytes encoded as exactly 64 hexadecimal characters |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | Private token used during webhook subscription verification |
| `STRAVA_SUBSCRIPTION_ID` | Positive subscription ID returned by Strava after registration |
| `STRAVA_PROCESS_SECRET` | Private bearer value required by the internal worker endpoint |

`STRAVA_ACCESS_TOKEN` is not used. Each runner authorizes separately, and their access/refresh tokens are encrypted at rest. Do not rotate `STRAVA_ENCRYPTION_KEY` until all stored encrypted tokens have been migrated to the new key; otherwise existing connections cannot be decrypted and must reauthorize.

The OAuth application callback must exactly equal `STRAVA_CALLBACK_URL`. The application starts authorization only from same-origin `POST /api/strava/connect` with the authorized `runnerId`. Ordinary recap reads never call Strava.

## Database and race configuration

1. Use a local or dedicated non-production Supabase project. Never run integration tests against production.
2. Apply every committed migration in filename order. The Strava chain ends with:
   - `20261026175630_strava_integration.sql`
   - `20261028192351_strava_lifecycle.sql`
   - `20261101000100_strava_race_matching.sql`
   - `20261101000200_strava_worker_matching.sql`
   - `20261102074802_strava_atomic_confirmation.sql`
   - `20261102192931_strava_runner_scope_privacy.sql`
3. Add one `strava_race_configs` row for each category under test. Use an inclusive UTC start window, `allowed_sport_types = ARRAY['Run']`, and `distance_tolerance_m = 500`. Category distance comes from `categories.distance_km`.
4. Supply `start_latitude`, `start_longitude`, and `start_radius_m` together, or leave all three null. Null configured coordinates or missing activity GPS always require runner confirmation. Exactly one candidate can auto-select only when sport, time, distance, and configured start-area checks all pass.

For manual provider acceptance, create a clearly labeled temporary QA-only window around a private test `Run` in the dedicated test database. Keep private coordinates and activity IDs outside commits, reports, screenshots, logs, and issue text. Record the original rows first and restore the Soekarno Run configuration immediately after the test, even if acceptance fails.

Completed runner-bound OAuth attempts persist the runner opt-in for the current connection generation, beyond the callback expiry. Workers, candidates, and selections enforce that scope. A user with several owned runners must disconnect the existing scoped recap before connecting another. Explicit Connect can bind an older active grant that has no runner scope. The final migration removes pre-fix accidental candidate/selection fan-out and private snapshots unrelated to a retained scoped candidate; sample metrics and credentials remain intact. Worker reclassification removes rejected activity snapshots and dependent live metrics without accumulating tombstones.

## Webhook and worker operations

After deploying an explicitly authorized test environment:

1. Configure `STRAVA_WEBHOOK_VERIFY_TOKEN`, then register the public `https://<test-host>/api/strava/webhook` callback using Strava's approved subscription workflow. The route answers the verification challenge. Store the returned positive subscription ID as `STRAVA_SUBSCRIPTION_ID`.
2. Configure a scheduler to send a same-host `POST /api/internal/strava/process` with `Authorization: Bearer <STRAVA_PROCESS_SECRET>`. The route has a 60-second maximum duration and processes bounded leased work. Do not put the secret in a URL or scheduler logs.
3. Confirm the scheduler observes successful `{ "ok": true }` responses and alert on repeated failures. Inspect failed jobs only through trusted backend/database tooling.

No subscription or scheduler is created by this repository. Webhook POST bodies are not provider-signed; the worker validates subscription, connection generation, athlete ownership, and current provider state before destructive changes.

## Repeatable local gates

Install dependencies, then run:

```powershell
npm test
npm run test:native
npm run lint
npx tsc --noEmit
npm run build
git diff --check
git status --short --branch
```

`npm run test:native` always runs the non-database native checks. To activate the isolated PostgreSQL migration suite, install PGlite outside the repository and set `STRAVA_PGLITE_MODULE` to its `dist/index.js` entry before rerunning the command. Do not add PGlite to the application dependencies solely for this gate.

The controlled HTTP fixtures must cover: consent success and denial, partial scope, complete/partial/malformed metrics, zero/no/ambiguous match, missing GPS, rate limiting with `Retry-After`, token refresh, provider revocation, repeated callbacks/events, and disconnect cleanup. These fixtures do not replace real-provider acceptance.

## Dedicated Supabase gate

Use only a disposable project whose hostname matches `SUPABASE_DEMO_PROJECT_REF`. Apply the full migration chain first. Supply ignored test values for `SUPABASE_URL`, `SUPABASE_DEMO_PROJECT_REF`, and either `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`; the wider wrapped-flow suite also needs the existing publishable/demo-user variables documented by the test environment.

```powershell
$env:RUN_STRAVA_DATABASE_TESTS = '1'
npm run test:db
Remove-Item Env:RUN_STRAVA_DATABASE_TESTS
```

The suite creates disposable users/events and removes them in teardown. Verify cleanup after any interrupted run. Record project type, migration commit, test counts, and cleanup result, but never credentials or project secrets.

## Manual real-provider acceptance

Use an authorized private test account and the temporary QA-only race window.

1. Open the authorized runner recap. Confirm the baseline chip recap, photos, and export are usable before connecting and that no OAuth navigation begins automatically.
2. Select **Connect Strava**. Verify consent denial returns to the same recap with readable feedback and intact baseline content. Repeat and grant the required activity scope.
3. Process queued work through the authorized scheduler. Verify importing, then one of: automatic selection for exactly one full match; explicit confirmation for ambiguity or missing location; or no-match without baseline loss.
4. For a selected activity, compare only available average heart rate, maximum heart rate, elevation gain, calories, and raw Strava cadence. Missing values must remain absent. Confirm a refresh preserves the selected state.
5. Trigger a controlled provider failure/rate limit and verify the baseline recap remains usable and the worker retries according to provider guidance.
6. Select **Disconnect**. Verify local live metrics disappear immediately while chip results/photos/export remain; then verify remote revocation completes or the UI truthfully remains `disconnecting`/requires reauthorization for cleanup.
7. Restore the original Soekarno Run configuration and remove any disposable fixtures.

## Browser and privacy acceptance

At recorded desktop and mobile viewports, verify keyboard access, visible focus, readable state/status feedback, candidate confirmation, disconnect, and callback-message cleanup from the address bar. Confirm one recap request per refresh and no duplicate provider call from ordinary recap loading.

Export a 1080 × 1350 PNG and confirm it contains the correct runner's chip recap but no live health metrics. Inspect HTML, JSON responses, browser storage, application logs, screenshots, exported images, and `git diff` for tokens, secrets, private coordinates, route geometry, or athlete identifiers. The owner-authorized API may return provider `activityId` for confirmation; keep real activity IDs out of logs, screenshots, exports, and committed artifacts. Organizer-only access must never reveal runner live metrics or connection controls.

## Recording results

For each executed gate, record date/time, environment (without secrets), command or user journey, pass/fail counts, cleanup, and remaining limitations in this file and [the acceptance matrix](acceptance-matrix.md). Mark an external gate complete only from observed evidence. A missing credential, unavailable test project, or unauthorized external action is a documented skip—not a pass.
