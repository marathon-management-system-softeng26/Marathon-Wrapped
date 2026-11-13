# QA — Strava-first runner claims

Verification record for `docs/superpowers/plans/2026-11-11-strava-first-runner-claims.md`
(spec: `docs/superpowers/specs/2026-11-11-strava-first-runner-claims-design.md`).

Planned coverage and executed evidence are kept apart, per
`docs/DOCUMENTATION_GUIDELINES.md`. Nothing below is marked passed unless it was observed
in the run recorded here.

- **Branch / worktree:** `dev` @ `05e1fc4` + Task 14 test additions
- **Run date:** 2026-11-13
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

## 4. Gates NOT executed — external prerequisites outstanding

These require resources outside this worktree and are **not** claimed as passing.

| Step | Gate | Missing prerequisite |
|---|---|---|
| 4 | `npm run test:db` | All migrations applied to dedicated project `anbnuegocddoowagqmxw`, including the new `20261113113000_strava_organizer_race_config.sql`; built server on port 3007; `.env.demo.local` seeded accounts |
| 5 | Supabase database advisors | Hosted project access; migrations applied |
| 6 | Manual browser acceptance (desktop + mobile) | A browser session against a running app with seeded data |
| 7 | Real Strava acceptance | A configured Strava application: client id/secret, callback URL, athlete capacity, webhook subscription, private test athlete and activity |

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
