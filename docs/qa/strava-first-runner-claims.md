# QA — Strava-first runner claims

Verification record for `docs/superpowers/plans/2026-11-11-strava-first-runner-claims.md`
(spec: `docs/superpowers/specs/2026-11-11-strava-first-runner-claims-design.md`).

Planned coverage and executed evidence are kept apart, per
`docs/DOCUMENTATION_GUIDELINES.md`. Nothing below is marked passed unless it was observed
in the run recorded here.

- **Branch / worktree:** `dev` @ `05e1fc4` + Task 14 test additions
- **Run date:** 2026-11-13 (migrations applied and database gates executed the same day)
- **Runtime:** Windows 11, Node 22.18+, Next.js 16.3

## 1. Automated gates — executed

All six commands from Task 14 Step 3 were run in this worktree.

| Gate | Command | Result |
|---|---|---|
| Unit / component / API | `npm test` | **pass** — 547 passed, 21 skipped (33 files: 31 passed, 2 skipped) |
| Dependency-free boundary | `npm run test:native` | **pass** — 36 tests, 35 pass, 0 fail, 1 skipped |
| Lint | `npm run lint` | **pass** — exit 0, no findings |
| Types | `npx tsc --noEmit` | **pass** — exit 0 |
| Production build | `npm run build` | **pass** — compiled successfully; `/runners/[runnerId]/strava` and `/api/organizer/events/[eventId]/strava-config` registered dynamic |
| Whitespace | `git diff --check` | **pass** — no findings |

### Documented skips and their prerequisites

Each skip names the prerequisite it is waiting on. None is evidence of success.

| Skipped | Count | Missing prerequisite |
|---|---|---|
| `tests/integration/wrapped-flow.test.ts` | 18 | `RUN_DATABASE_TESTS=1` plus a built app server on the dedicated project (Step 4) |
| `tests/integration/strava-lifecycle.test.ts` | 3 | `RUN_STRAVA_DATABASE_TESTS=1` against the dedicated project (Step 4) |
| `tests/native/strava-database.test.mts` → "Strava migration and lifecycle interleavings on PostgreSQL" | 1 | `STRAVA_PGLITE_MODULE` pointing at a PGlite entry module |

## 2. Account, claim and access coverage — written, execution gated

Added to `tests/integration/wrapped-flow.test.ts`. These assert against real Postgres and
real HTTP, so they run only under Step 4.

| Assertion | Covers |
|---|---|
| Unclaimed registration is absent from the claiming account's catalog | UR-F claim visibility |
| One-time code redeems once; a second account's redemption returns 400 | exactly one owner |
| `runner_access` holds exactly one row after the race to claim | spec "one registration has at most one direct runner owner" |
| Organizer catalog stays events-only and `GET /api/runners/:id/strava` returns 404 for the organizer | organizer isolation; denial does not confirm existence |
| Revoked, malformed and well-formed-but-unknown codes all return 400 and echo neither runner id nor BIB | claim replay / enumeration |
| Organizer race config is readable and writable only by that event's organizer; a runner account receives 403; an inverted window returns 422 | event-scoped configuration |
| Disposable runners, access rows and events are deleted in `finally` | cleanup |

## 3. Controlled-provider lifecycle coverage — written, execution gated

Added to `tests/integration/strava-lifecycle.test.ts` (synthetic encrypted token values
only; no provider call is made).

| Assertion | Covers |
|---|---|
| One athlete connection attaches a second registration without re-authorizing | multi-runner attachment |
| The same activity cannot be confirmed for two registrations in one generation | duplicate-activity conflict |
| Detaching one race clears only its rows and keeps the other registration's | per-race detach |
| After account disconnect, `strava_enqueue_projection` returns false and confirmation returns `obsolete` | obsolete-generation suppression |
| No snapshot row survives for either registration | no obsolete publish |

## 3b. Deployment and database gates — EXECUTED 2026-11-13

All 29 migrations were applied to dedicated project `anbnuegocddoowagqmxw`
(`marathon-wrapped`, ap-southeast-1) via the Supabase Management API SQL endpoint, each
recorded in `supabase_migrations.schema_migrations` under its own filename version so the
recorded history matches the repository exactly.

Preflight before writing: remote history stopped at `20261020020029`; **0** duplicate-owner
runners, so the `20261111054520` abort condition did not apply; the only pre-existing
`strava%` table was `strava_metrics` from migration 1, so no object collided.

| Gate | Command / tool | Result |
|---|---|---|
| Migration application | Management API, 24 pending applied in filename order | **pass** — 29 recorded, versions match filenames |
| Schema verification | catalog queries | **pass** — 11 `strava%` tables; tolerance check is `distance_tolerance_m > 0 AND <= 5000`; RLS enabled on every public table (0 unprotected) |
| Dedicated database integration | `npm run test:db` (built server on 3007) | **pass** — 18/18 in `wrapped-flow`, including the three claim/config tests added in Task 14 |
| Strava lifecycle concurrency | `RUN_STRAVA_DATABASE_TESTS=1` on `strava-lifecycle` | **pass** — 3/3, including multi-runner attach, per-race detach and obsolete-generation suppression |
| Security advisors | `get_advisors security` | **no ERROR**. 20 × `rls_enabled_no_policy` (INFO) is the intended deny-all posture: RLS on with no policies and all browser grants revoked, so every read goes through the service-role client behind a server guard. 1 × WARN: leaked-password protection disabled (Auth setting, not schema) |
| Performance advisors | `get_advisors performance` | **no ERROR/WARN**. 4 × unindexed composite FK (INFO) and 14 × unused index (INFO, expected with no traffic yet) |

Live behaviour confirmed against the migrated project:

- Runner catalog returns the Task 10 row shape with `workflowState`/`primaryAction` and no
  athlete, activity, token or fence value; the organizer catalog returns events only.
- Organizer results carry `linked` per registration with no account email or user id.
- A claim code issued by the organizer redeems exactly once: the second account receives 400
  with no registration disclosed, `runner_access` holds one owner, and the claim row is
  consumed with only its hash stored.
- One account holds two registrations after claiming, per the spec.
- Organizer race config stores a 400 m tolerance — impossible before migration 29 — and
  normalizes `+07:00` to UTC; missing timezone, inverted window, out-of-range tolerance and
  partial start location each return 422; a foreign category returns 404.
- `/organizer` redirects a signed-out visitor (307 → `/login`); a cross-origin config write is
  refused with 403 before any identity work; another runner's registration returns 404.

Two defects were found and fixed by running these gates, both in work added during this plan:

1. Migration 29's own verification guard used `like '%= 500%'`, which the bound in
   `distance_tolerance_m <= 5000` satisfies as a substring. The migration therefore aborted
   itself on a false positive and rolled back cleanly. Replaced with a regex that matches a
   true equality pin only.
2. The Task 14 multi-runner lifecycle test was written without execution and carried three
   fixture errors: stored activity detail lacked the `id`/`athleteId`/`sportType` fields the
   confirm RPC joins on, only one runner held each candidate so the duplicate-activity
   conflict was unreachable, and `strava_enqueue_projection` returns a build id rather than a
   boolean.

## 4. Gates NOT executed — external prerequisites outstanding

These require resources outside this worktree and are **not** claimed as passing.

| Step | Gate | Missing prerequisite |
|---|---|---|
| 6 | Manual browser acceptance (desktop + mobile) | A browser session; the Claude browser extension was not connected during this run |
| 7 | Real Strava acceptance | A configured Strava application: client id/secret, callback URL, athlete capacity, webhook subscription, private test athlete and activity. No `STRAVA_*` variable is set in this environment |

Deferred from the advisors rather than fixed:

- Leaked-password protection remains disabled on Auth (one dashboard toggle).
- The 4 unindexed composite foreign keys are accepted for now: every current query path
  filters on `user_id` plus `generation`, which existing indexes already cover. Revisit if
  cascade deletes or those FK columns become hot.

Carried release risks recorded during execution, still open:

- The one-time two-table trigger-install deadlock risk from Task 8 round 3 requires the
  documented drained rollout with bounded lock/statement timeouts (Task 15).
- Old workers must be drained or replaced before the coordinate-privacy migration applies.
- The revoke RPC signature change needs a coordinated schema/application rollout if old and
  new application versions overlap.
- `distance_tolerance_m` only becomes organizer-settable once
  `20261113113000_strava_organizer_race_config.sql` is applied; before that the database
  still pins it to 500.

## 5. Privacy assertions covered by executed tests

These ran in `npm test` and are evidence now, not pending:

- `tests/api/session.test.ts` — the catalog payload carries no athlete id, activity id,
  token, payload, candidate or fence value, and every `strava_*` read is owner-scoped.
- `tests/api/runnerStrava.test.ts` — every runner response is checked against `polyline`,
  `token`, `raw`, `payload`, `startLatLng`, coordinate literals, `athleteId`, `generation`
  and `user_id`.
- `tests/recapStravaFirst.test.ts` — the showcase discloses no rank, percentile, overtake,
  chip state, route map or provider identifier, and omits optional metrics rather than
  rendering zeros.
- `tests/exportWrapped.test.ts` — the 1080 × 1350 PNG contains no elapsed time, health
  metric, identifier or coordinate, and carries "Powered by Strava".
- `tests/organizerRunnerAccess.test.ts` — organizer claim status shows no account email or
  user id, and a refused claim renders no code.
