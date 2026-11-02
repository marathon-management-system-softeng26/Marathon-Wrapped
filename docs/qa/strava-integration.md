# Strava integration setup and acceptance runbook

Updated November 2, 2026. This runbook separates repeatable local evidence from credential-gated external acceptance. It does not authorize deployment, remote migrations, webhook registration, or provider calls.

## Current evidence status

| Gate | Current evidence | Acceptance status |
| --- | --- | --- |
| Unit, route, service, UI-model, privacy, and export tests | Latest implementation run: 313 passed, 17 environment-gated skips | Implemented; rerun in Task 11 |
| Local PostgreSQL migration/lifecycle/worker/confirmation checks | 11 passed with an external PGlite runtime after all migrations | Implemented locally; rerun in Task 11 |
| Dedicated Supabase concurrency suite | Not run; no dedicated-project credentials were supplied | Pending |
| Real Strava OAuth, import, webhook, refresh, and revocation | Not run; no test application/account credentials were supplied | Pending |
| Desktop/mobile, keyboard/focus, callback URL cleanup, and PNG privacy | Automated/static coverage exists; complete manual pass not run for this integration | Pending |

No full FR-08–FR-11 acceptance is claimed until every applicable pending gate is recorded below.

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
3. Add one `strava_race_configs` row for each category under test. Use an inclusive UTC start window, `allowed_sport_types = ARRAY['Run']`, and `distance_tolerance_m = 500`. Category distance comes from `categories.distance_km`.
4. Supply `start_latitude`, `start_longitude`, and `start_radius_m` together, or leave all three null. Null configured coordinates or missing activity GPS always require runner confirmation. Exactly one candidate can auto-select only when sport, time, distance, and configured start-area checks all pass.

For manual provider acceptance, create a clearly labeled temporary QA-only window around a private test `Run` in the dedicated test database. Keep private coordinates and activity IDs outside commits, reports, screenshots, logs, and issue text. Record the original rows first and restore the Soekarno Run configuration immediately after the test, even if acceptance fails.

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

Export a 1080 × 1350 PNG and confirm it contains the correct runner's chip recap but no live health metrics. Inspect HTML, JSON responses, browser storage, application logs, screenshots, exported images, and `git diff` for tokens, secrets, private coordinates, route geometry, athlete identifiers, or private activity IDs. Organizer-only access must never reveal runner live metrics or connection controls.

## Recording results

For each executed gate, record date/time, environment (without secrets), command or user journey, pass/fail counts, cleanup, and remaining limitations in this file and [the acceptance matrix](acceptance-matrix.md). Mark an external gate complete only from observed evidence. A missing credential, unavailable test project, or unauthorized external action is a documented skip—not a pass.
