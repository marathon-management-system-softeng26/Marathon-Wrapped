# Private runner photos acceptance

**November 25, 2026.** The local photo service, routes, database lifecycle and mobile fixture checks passed. The disposable HTTP/Storage journey skipped because its dedicated credentials were absent. Hosted Storage privacy, deployment configuration, scheduled cleanup and target-database advisors still require acceptance.

## Local evidence

| Check | Evidence |
| --- | --- |
| Three slots and recovery | The SQL fixture ran on PGlite and PostgreSQL 18.3. A second connection waited for the third slot to commit and could not reserve a fourth, including under a stale snapshot. The fixture covers reservation expiry, lease recovery, exact-path cleanup, grace periods, and deletion on ownership release. |
| Authorization and caching | Route/service tests exercised owner-only reads, generic errors and fresh authorization after deletion or release. Success returns `image/webp`, accurate `Content-Length`, `Cache-Control: private, no-store`, `Pragma: no-cache` and `X-Content-Type-Options: nosniff`. These were local handler and transport checks. |
| Bucket and worker | Native SQL required the private bucket, MIME and size limits, RLS and service-only grants. An incompatible existing bucket aborted the migration. Worker tests exercised delayed staging cleanup, leases, retries, batch limits and outbox acknowledgement. The native harness supplies a minimal Storage schema. |
| Manager at 320 × 568 / 390 × 844 | Earlier Chrome checks on the local Next manager used fixture API and image responses. Ready, pending and empty slots fit in one column, measured at 265 / 335 CSS px. At 320 px there was no horizontal overflow and the measured controls were at least 44 × 44 px. The 390 px picker had a visible keyboard outline. |
| Focus and errors | Chrome kept focus on the inclusion checkbox during a delayed PATCH, sent one write for two Space presses, and reconciled the saved selection after a lost response. Enter on Delete at desktop width returned focus to the slot heading. Component tests cover picker validation, upload errors and retries. Gallery tests exercise failed thumbnails, failed enlargement, a surviving organizer photo and subsequent statistics navigation. |
| Empty and populated Wrapped at both mobile sizes | In-app browser, production Next build, loopback fixture responses. At 320 × 568 the document client/scroll widths were both 305 px with a scrollbar. At 390 × 844 both were 375 px. The empty scene retained the manager link. Both populated photos decoded, “Your photo” appeared before “Organizer photo,” and the personal photo dialog opened and closed. |
| Downloadable card | All four browser cases produced a 1080 × 1350 PNG from Save image. Each export made zero raster-image drawing calls and drew the same 11 text items, including 5.1 km and 24:08 moving time. The unit export check also observes zero photo fetches, image constructions or image draws. |
| Local gates | Full Vitest with bounded workers passed 927 and skipped 23 across three opt-in integration suites. TypeScript, repository ESLint and the production build passed. With both photo database adapters, native passed 37 and skipped three older optional tests. Enabling the older PGlite tests produced 37 passes and three failures creating the already-existing `runner_profiles` relation in official results, publication and Strava lifecycle. |
| Migration history and advisors | The photo migration appears once at the end of the repository's migration list. CLI 3.3.0 supports `db advisors`. Both the CLI local migration list and advisors failed to connect to 127.0.0.1:54322. The Docker engine was unavailable. Target migration history and advisor findings remain open. The local advisor command was `npx --yes supabase@3.3.0 db advisors --type all --level info --fail-on warn`. |

## Run the transactional SQL gate

Run the SQL gate from the repository root on the isolated, migrated database before creating HTTP fixtures. Use an empty photo queue and a direct or session-mode PostgreSQL connection. The fixture creates session-local helpers, switches to `service_role` for the lifecycle checks, and rolls back its generated data.

Configure a libpq service named `runner_photo_disposable` with the isolated database's host, port, database and test administrator in the operator's service file. Supply its password through the PostgreSQL password file. The account needs permission to create the Auth fixtures and switch to `service_role`. Run the gate with the dedicated opt-in enabled.

```powershell
if ($env:RUNNER_PHOTO_TEST_DISPOSABLE -ne '1') { throw 'Disposable photo project opt-in required' }
psql -X --dbname='service=runner_photo_disposable' --set=ON_ERROR_STOP=1 --command='SET plpgsql.check_asserts = on' --file='tests/sql/runner-photo-uploads.sql'
if ($LASTEXITCODE -ne 0) { throw 'Private runner photo SQL gate failed' }
```

Record exit code zero and the final `ROLLBACK`. A failed SQL assertion or statement stops the gate. The session closes on exit and PostgreSQL rolls back an open transaction.

## Run the disposable HTTP/Storage journey

Use an isolated Supabase project or a local Supabase stack with Auth, PostgREST and Storage, the current migrations, and an app instance pointed exclusively at that project. The suite creates two confirmed accounts, an event, category, registration and organizer photo. It invokes the project-wide cleanup worker. Use an environment dedicated to this suite with no unrelated jobs. Supply the following test-only environment variables to the test process.

| Variable | Purpose |
| --- | --- |
| `RUNNER_PHOTO_TEST_DISPOSABLE` | Explicit opt-in. Set to `1` only for the isolated environment. |
| `RUNNER_PHOTO_TEST_SUPABASE_URL` / `RUNNER_PHOTO_TEST_PROJECT_REF` | Matching project origin and project ref. A loopback Supabase URL uses the ref `local`. |
| `RUNNER_PHOTO_TEST_PUBLISHABLE_KEY` | The isolated project's public client key for Auth and client Storage operations. |
| `RUNNER_PHOTO_TEST_SERVICE_ROLE_KEY` | Its server-side fixture key. |
| `RUNNER_PHOTO_TEST_APP_ORIGIN` | HTTPS application origin, or HTTP loopback, running this release against that same project. |
| `RUNNER_PHOTO_TEST_PROCESS_SECRET` | The isolated app's worker bearer secret, supplied through the test environment. |

Run just the photo suite with `npm test -- tests/integration/runner-photo-flow.test.ts`. To use the repository's database script, first disable its two unrelated suites in the process environment. That script loads the existing local env files and includes the entire integration directory.

```powershell
$env:RUN_DATABASE_TESTS = '0'
$env:RUN_STRAVA_DATABASE_TESTS = '0'
npm run test:db -- tests/integration/runner-photo-flow.test.ts
```

A green exit with skipped cases means live acceptance is still pending. A complete run has **two passing photo tests**. Their teardown deletes the generated event and accounts. The database queues exact staging keys for removal after their real capability deadlines. Leave the worker running through those deadlines and the ten-minute grace period.

## Release evidence to fill in

Record the date, release commit, project ref, app revision, tester and a redacted evidence reference for each row. Keep credentials, cookies, signed upload tokens, object paths and runner images out of the record.

| Pending check | Passing observation | Result / evidence |
| --- | --- | --- |
| Migration and permissions | Confirm intended project history first. Apply outstanding prerequisites then `20261124133324_private_runner_photo_uploads.sql`. Verify it appears once. Run the transactional SQL gate above against the migrated disposable database. Inspect RLS, grants, indexes, Storage policies and security/performance advisors. Reconcile duplicate runner-profile migration history before replaying on a new target. | Pending |
| Real Storage | Bucket is private, limit 5,242,880 bytes, JPEG/PNG/WebP only. Against known-existing staging and ready objects, public URLs and direct anonymous, owner and organizer Storage downloads deny access. Owner-only content loads through the app. | Pending |
| Slots and gallery | Four simultaneous reservations give three 201s and one 409. Upload generated fixtures, reload while pending, complete all three, deselect one, and see two personal photos before the organizer photo. | Pending |
| Interrupted requests | Stop after reserve, sign, activate, prepare, write and finalize. Verify unsigned expiry, cancellation with the signed staging deadline preserved, abandoned writer cleanup, retry after an expired lease, and idempotent completion after a lost success response. The suite ages only its own unsigned reservation and interrupted writer leases. | Pending |
| Revocation | With fresh requests, owner gets 200 plus the documented private image headers, organizer gets 404 and an unsigned viewer gets 401. After delete the old app content URL gives 404. Retrying the original signed upload against its staging path leaves the photo unserved. After release every old content URL gives 404 for the former owner. | Pending |
| Scheduler and final drain | Verify the restricted deployment receives authenticated periodic POSTs, observes swept/processed counts, removes due ready/provisional objects, and retains staging tombstones before their deadlines. After the last deadline and grace, verify the fixture objects and cleanup jobs are gone. | Pending |
| Deployed UI | Repeat manager, empty and populated Wrapped at both viewports using synthetic accounts. Tab through inputs, retry an error, open a photo, toggle selection, and save a card. Inspect the PNG for statistics only. | Pending |

## Rollout and rollback

Use the README sequence on the authorized target. Migrate and provision, inspect the private bucket, set the server-only cleanup secret, deploy with access restricted, and schedule the mandatory same-host worker POST. Complete disposable acceptance and review the evidence before enabling users. [Operational rollout steps](../../README.md#rollout)

For rollback, disable the entry links and new reservations first. Preserve deletion and scheduled cleanup while leases and signed capabilities expire. If retiring data, revoke metadata through the deletion lifecycle and drain every resulting job. Verify that both the outbox and bucket are empty before retiring the worker or removing tables. The bucket stays private. [Rollback steps](../../README.md#rollback)
