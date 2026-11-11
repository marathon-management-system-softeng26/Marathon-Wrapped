# Strava-First Runner Claims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a confirmed account securely claim organizer-prepared runner registrations, expose a Strava action for every claimed runner, and generate the runner-facing Wrapped showcase only from a selected Strava activity.

**Architecture:** Supabase Auth establishes identity, organizer-issued one-time claim codes create server-owned `runner_access`, and one encrypted Strava athlete connection can attach to several directly owned registrations. A background job imports and selects race activities, then projects a privacy-minimized, versioned Wrapped snapshot from normalized Strava detail; dashboard and Wrapped reads use stored workflow state and never call Strava directly.

**Tech Stack:** Next.js 16.3 App Router and Route Handlers, React 19, TypeScript, Supabase Auth/Postgres/Storage, `@supabase/ssr`, `@supabase/supabase-js`, Strava API v3 OAuth 2.0, Vitest, Node native tests, PostgreSQL migration tests.

**Spec:** `docs/superpowers/specs/2026-11-11-strava-first-runner-claims-design.md`

## Global Constraints

- Strava is the required performance source for new runner-facing Wrapped output; chip data must not contribute statistics, rank, splits, or insights.
- Trusted registration context remains organizer-owned: runner identity, BIB, event, category, race window, and expected distance.
- Authorization uses verified Supabase user IDs plus service-managed tables; never authorize with BIB, email alone, `user_metadata`, request-supplied user IDs, or Strava athlete IDs.
- Browser code receives only the Supabase publishable key. Service-role keys, Strava client secret, encryption key, worker secret, tokens, raw provider payloads, routes, and coordinates remain server-only.
- One Auth user may own multiple registrations; one registration has at most one direct runner owner.
- One encrypted Strava athlete connection may attach to multiple directly owned registrations; each attachment is independently importable, selectable, detachable, and projectable.
- Within one user connection generation, one activity can produce at most one registration showcase.
- Missing Strava fields remain null and disappear from presentation; never invent zeros or chip fallbacks.
- Ordinary dashboard and Wrapped reads use stored database state only; no request-time Strava API calls.
- Keep the legacy chip schema and organizer timing editor during this release for rollback, but remove them from runner-facing Wrapped contracts.
- Preserve the existing uncommitted login error fix in `app/api/auth/login/route.ts` and `tests/api/session.test.ts`; commit it separately before implementing this plan.
- Do not modify already-applied migration files. Create new migrations using `supabase migration new` after checking `supabase --help`; if the CLI remains unavailable, install/use it explicitly during execution rather than inventing migration versions.
- Apply schema changes first to a dedicated non-production project. Do not run credential-dependent or destructive integration tests against an unrelated or production project.
- Request `activity:read_all` only with clear consent copy because private activities must be eligible; validate the actually granted scope.
- Configure and respect Strava athlete-capacity and API-rate limits before multi-runner acceptance.

## Review Focus

- A stolen, expired, replayed, revoked, or cross-event claim code must not disclose or grant a registration; covered in Task 3 API and Task 2 SQL tests.
- Two users racing to claim the same registration must produce exactly one owner; covered in Task 2 concurrent database assertions and Task 3 API tests.
- Two registrations with overlapping windows must not select the same Strava activity; covered in Task 7 projection/selection tests.
- Disconnect or detach during import/projection must not let an obsolete generation publish a snapshot; covered in Tasks 6 and 10 lifecycle tests.
- Partial or malformed provider fields must omit optional cards or fail safely without chip fallback, NaN, Infinity, coordinates, or tokens; covered in Tasks 7–9.

---

### Task 0: Isolate the existing authentication fix

**Files:**
- Existing modifications: `app/api/auth/login/route.ts`
- Existing modifications: `tests/api/session.test.ts`

**Interfaces:**
- Consumes: existing login route and Supabase error code `email_not_confirmed`
- Produces: a clean baseline commit before feature work

- [ ] **Step 1: Verify the existing focused regression**

Run: `npx vitest run tests/api/session.test.ts`

Expected: 8 tests pass, including the confirmation-required response.

- [ ] **Step 2: Verify the existing tree before isolation**

Run: `npm test && npm run lint && npx tsc --noEmit && git diff --check`

Expected: all non-credential tests pass, lint/type checks exit 0, and the diff check is empty.

- [ ] **Step 3: Commit only the existing authentication fix**

```bash
git add app/api/auth/login/route.ts tests/api/session.test.ts
git commit -m "fix: explain unconfirmed account sign-in"
```

Do not include the design or this plan in that commit.

---

### Task 1: Record the Strava-first product contract

**Files:**
- Modify: `PRODUCT.md`
- Modify: `docs/SRS_v4.md`
- Modify: `docs/requirements-register.md`
- Modify: `README.md`
- Modify: `docs/qa/acceptance-matrix.md`
- Modify: `docs/qa/prd-comparison-2026-11-10.md`

**Interfaces:**
- Consumes: approved design at `docs/superpowers/specs/2026-11-11-strava-first-runner-claims-design.md`
- Produces: authoritative requirements used by every later task and acceptance check

- [ ] **Step 1: Update the authority and decision history**

State explicitly that the November 11 decision supersedes chip-first Wrapped generation. Keep registration identity/event context and optional BIB photos, but require a selected Strava activity before the showcase is `ready`.

- [ ] **Step 2: Replace incompatible functional requirements**

Document signup/confirmation, one-time claim, per-runner Strava action, shared athlete connection with runner attachments, stored projection, detach, account disconnect, and no chip-derived ranking claims.

- [ ] **Step 3: Update setup and operational prerequisites**

List the six currently unapplied Strava migrations, the new migrations from this plan, exact Strava environment variables, worker/scheduler/webhook requirements, Supabase email URL/SMTP requirements, and athlete-capacity gate.

- [ ] **Step 4: Review documentation consistency**

Run: `rg -n "chip.*baseline|baseline.*chip|optional Strava|rank|percentile|overtake" PRODUCT.md README.md docs/SRS_v4.md docs/requirements-register.md docs/qa`

Expected: every remaining match is either historical and labeled as superseded, or describes legacy organizer data rather than runner-facing Wrapped behavior.

- [ ] **Step 5: Commit**

```bash
git add PRODUCT.md README.md docs/SRS_v4.md docs/requirements-register.md docs/qa docs/superpowers/specs/2026-11-11-strava-first-runner-claims-design.md docs/superpowers/plans/2026-11-11-strava-first-runner-claims.md
git commit -m "docs: define Strava-first runner workflow"
```

---

### Task 2: Add secure runner-claim persistence

**Files:**
- Create: new Supabase migration generated as `strava_first_runner_claims`
- Create: `tests/sql/runner-claims.sql`
- Modify: `tests/native/strava-database.test.mts`
- Modify: `db/README.md`

**Interfaces:**
- Consumes: `auth.users`, `events`, `categories`, `runners`, `runner_access`, `organizer_access`
- Produces: `runner_claims`; `create_runner_claim(p_organizer uuid, p_event bigint, p_runner uuid, p_hash text, p_expires_at timestamptz) -> uuid`; `consume_runner_claim(p_user uuid, p_hash text) -> text`; `revoke_runner_claim(p_organizer uuid, p_event bigint, p_claim uuid) -> boolean`; unique direct ownership of `runner_access.runner_id`

- [ ] **Step 1: Write the failing SQL fixture**

In `tests/sql/runner-claims.sql`, assert literal outcomes for:

- organizer can create a claim only for their mapped event;
- stored values contain a hash, never the raw token;
- valid consumption creates one `runner_access` row and records the claimant;
- same-user replay returns `already_claimed_by_you` without duplication;
- different-user replay, expired, revoked, invalid, and cross-event claims return non-enumerating failure codes;
- two concurrent consumers cannot both own the runner;
- one user can claim a second runner;
- browser roles have no table or function privileges.

- [ ] **Step 2: Run the migration fixture and verify RED**

Run: `npm run test:native`

Expected: runner-claim fixture fails because the table/functions do not exist.

- [ ] **Step 3: Generate and implement the migration**

Run `supabase --help`, `supabase migration --help`, then `supabase migration new strava_first_runner_claims`.

Implement the spec's `runner_claims` columns, RLS, service-role-only grants, expiry/revocation indexes, atomic functions, and a unique index on `runner_access(runner_id)`. Add a preflight block that raises with a clear message if duplicate direct owners already exist; never select or delete an owner automatically.

- [ ] **Step 4: Register the SQL fixture with the native migration harness**

Make `tests/native/strava-database.test.mts` run the new fixture after the ordered migrations.

- [ ] **Step 5: Verify GREEN**

Run: `npm run test:native`

Expected: all required native/SQL tests pass; optional external-module tests may skip only for their documented missing module.

- [ ] **Step 6: Run database advisors on the disposable database**

Expected: no new security or health findings; performance findings are either fixed with bounded indexes or documented.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations tests/sql/runner-claims.sql tests/native/strava-database.test.mts db/README.md
git commit -m "feat: add secure runner claims"
```

---

### Task 3: Implement organizer claim and runner consumption APIs

**Files:**
- Create: `lib/auth/runnerClaims.ts`
- Create: `app/api/claims/route.ts`
- Create: `app/api/organizer/events/[eventId]/runners/[runnerId]/claim/route.ts`
- Create: `tests/api/runnerClaims.test.ts`
- Modify: `lib/organizerHttp.ts`

**Interfaces:**
- Consumes: Task 2 RPCs, `requireUser()`, `requireOrganizerAccess()`, `privateHeaders`, `sameOrigin()`
- Produces:
  - `createRunnerClaim(userId: string, eventId: number, runnerId: string): Promise<{ id: string; token: string; expiresAt: string }>`
  - `consumeRunnerClaim(userId: string, token: string): Promise<"claimed" | "already_claimed_by_you">`
  - `revokeRunnerClaim(userId: string, eventId: number, claimId: string): Promise<void>`
  - organizer `POST`/`DELETE` claim route and runner `POST /api/claims`

- [ ] **Step 1: Write failing route tests**

Test same-origin enforcement, verified session requirement, exact event/runner scope, 256-bit token generation, hash-only RPC arguments, seven-day expiry, one-time raw token response, no raw token in logs/errors, claim input bounds, idempotent same-user replay, and non-enumerating invalid/expired/revoked responses.

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run tests/api/runnerClaims.test.ts`

Expected: import or route-not-found failure for the new interfaces.

- [ ] **Step 3: Implement the service and routes**

Use `crypto.randomBytes(32).toString("base64url")` for the raw token and SHA-256 hex for storage. Validate one token, one event, and one runner per request. Return private, no-store responses. Map forbidden runner/event access to 404 and invalid claim consumption to one safe 400 message.

- [ ] **Step 4: Verify GREEN and related authorization tests**

Run: `npx vitest run tests/api/runnerClaims.test.ts tests/auth.test.ts tests/api/organizer.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/runnerClaims.ts lib/organizerHttp.ts app/api/claims app/api/organizer/events tests/api/runnerClaims.test.ts
git commit -m "feat: add runner claim APIs"
```

---

### Task 4: Add organizer bootstrap tooling

**Files:**
- Create: `lib/auth/grantOrganizer.ts`
- Create: `scripts/grant-organizer.mts`
- Create: `tests/native/grant-organizer.test.mts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `db/README.md`

**Interfaces:**
- Consumes: server-only Supabase admin client, exact confirmed Auth email, exact event ID/ref
- Produces: `grantOrganizerAccessByEmail(email: string, eventId: number): Promise<{ userId: string; eventId: number }>` and `npm run grant:organizer -- --email <email> --event-id <id>`

- [ ] **Step 1: Write failing native tests**

Cover missing/duplicate flags, malformed email/event ID, unconfirmed or missing user, missing event, explicit project-ref mismatch, successful idempotent upsert, and output that contains no keys/passwords.

- [ ] **Step 2: Verify RED**

Run: `node --test --experimental-strip-types tests/native/grant-organizer.test.mts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement the reusable service and thin script**

Require `SUPABASE_DEMO_PROJECT_REF` to match the project URL. Never permit self-promotion through an application route. Print only resolved IDs and success.

- [ ] **Step 4: Verify GREEN**

Run: `node --test --experimental-strip-types tests/native/grant-organizer.test.mts`

Expected: all grant-tool tests pass.

- [ ] **Step 5: Document the exact organizer-login workflow**

Document: create/confirm account → run trusted grant script → sign in → `/api/session` returns event → home displays **Manage event results** → `/organizer` remains server-guarded.

- [ ] **Step 6: Commit**

```bash
git add lib/auth/grantOrganizer.ts scripts/grant-organizer.mts tests/native/grant-organizer.test.mts package.json README.md db/README.md
git commit -m "feat: add organizer bootstrap command"
```

---

### Task 5: Add runner attachment and snapshot schema

**Files:**
- Create: new Supabase migration generated as `strava_runner_attachments_and_snapshots`
- Create: `tests/sql/strava-attachments.sql`
- Create: `tests/sql/strava-wrapped-snapshots.sql`
- Modify: `tests/native/strava-database.test.mts`

**Interfaces:**
- Consumes: existing Strava connection/generation, candidate, selection, job, and runner ownership tables after all six existing Strava migrations
- Produces:
  - `strava_runner_attachments(user_id, generation, runner_id, status, created_at, updated_at)`
  - `strava_wrapped_snapshots(user_id, generation, runner_id, activity_id, version, status, payload, error_code, updated_at)`
  - `strava_attach_runner(p_user uuid, p_runner uuid) -> text`
  - `strava_detach_runner(p_user uuid, p_runner uuid) -> text`
  - service-only snapshot transition functions
  - uniqueness preventing one activity from selection by two runner attachments in one generation

- [ ] **Step 1: Write failing SQL tests**

Assert direct-owner-only attachment, multiple runners per user/generation, no organizer-only attachment, idempotent attach, runner-scoped detach, shared connection retention, activity uniqueness, allowed snapshot transitions (`building` → `ready|failed`), obsolete-generation rejection, payload object/version bounds, and complete cascade cleanup.

- [ ] **Step 2: Verify RED**

Run: `npm run test:native`

Expected: attachment/snapshot fixture fails because the new schema is absent.

- [ ] **Step 3: Generate and implement the migration**

Use a new migration; do not edit the six existing Strava migrations. Replace the durable opt-in predicate with attachment membership while preserving direct `runner_access`. Add `project` to the bounded job kind constraint or create a dedicated projection-job table; prefer extending the existing lease/retry machinery.

- [ ] **Step 4: Add migration compatibility assertions**

Verify upgrade from the current one-runner OAuth attempt: create one attachment for each active, valid existing runner scope; do not infer additional attachments.

- [ ] **Step 5: Verify GREEN and advisors**

Run: `npm run test:native`

Expected: all SQL/native tests pass and advisors report no new security/health issues.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/sql/strava-attachments.sql tests/sql/strava-wrapped-snapshots.sql tests/native/strava-database.test.mts
git commit -m "feat: add Strava runner attachments and snapshots"
```

---

### Task 6: Adapt OAuth and lifecycle to multiple runner attachments

**Files:**
- Modify: `lib/strava/oauth.ts`
- Modify: `lib/strava/store.ts`
- Modify: `lib/strava/processing.ts`
- Modify: `app/api/strava/connect/route.ts`
- Create: `app/api/runners/[runnerId]/strava/attach/route.ts`
- Create: `app/api/runners/[runnerId]/strava/detach/route.ts`
- Modify: `tests/api/strava.test.ts`
- Modify: `tests/api/runnerStrava.test.ts`
- Modify: `tests/stravaProcessing.test.ts`

**Interfaces:**
- Consumes: Task 5 attachment RPCs, existing OAuth state/cookie/token primitives
- Produces:
  - `attachRunnerToStrava(userId: string, runnerId: string): Promise<RunnerStravaRoute>`
  - `detachRunnerFromStrava(userId: string, runnerId: string): Promise<"detached">`
  - OAuth completion attaches the initiating runner without excluding other owned attachments

- [ ] **Step 1: Write failing lifecycle tests**

Cover first runner requiring OAuth, second runner reusing an active verified athlete connection without new consent, unowned runner denial, two attachment imports, one-runner detach preserving the connection/other snapshot, and account disconnect clearing every attachment.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/api/strava.test.ts tests/api/runnerStrava.test.ts tests/stravaProcessing.test.ts`

Expected: second attachment and runner detach cases fail under the current one-runner scope.

- [ ] **Step 3: Implement attachment-aware OAuth and routes**

Keep state bound to the initiating runner and verified session. If a valid active connection exists, `POST .../attach` records the explicit runner opt-in and enqueues its bounded backfill. Otherwise the existing connect form starts OAuth. Do not accept a user/athlete ID from the request.

- [ ] **Step 4: Replace one-runner scope checks**

Update candidate, selection, worker, and read guards to require the exact attachment and current generation. Preserve organizer denial and obsolete-generation checks.

- [ ] **Step 5: Verify GREEN**

Run the focused command from Step 2.

Expected: all focused lifecycle tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/strava app/api/strava app/api/runners tests/api/strava.test.ts tests/api/runnerStrava.test.ts tests/stravaProcessing.test.ts
git commit -m "feat: support Strava per runner registration"
```

---

### Task 7: Normalize the Strava fields required for Wrapped

**Files:**
- Modify: `lib/strava/client.ts`
- Create: `lib/strava/projection.ts`
- Modify: `tests/stravaClient.test.ts`
- Create: `tests/stravaProjection.test.ts`

**Interfaces:**
- Consumes: Strava DetailedActivity fields from the owned selected activity
- Produces:
  - `StravaSplit = { kilometer: number; elapsedSeconds: number; movingSeconds: number; distanceMeters: number; averageSpeedMps: number | null }`
  - extended `StravaActivity` with `movingTimeSeconds`, `elapsedTimeSeconds`, `averageSpeedMps`, `maxSpeedMps`, and `metricSplits`
  - `buildStravaWrappedProjection(activity: StravaActivity, context: RunnerProjectionContext): StravaWrappedSnapshotV1`

- [ ] **Step 1: Write failing client normalization tests**

Use complete hand-written provider fixtures. Assert accepted zero values where valid, integer time bounds, ordered metric splits, rejection of strings/NaN/Infinity/negative time or distance, athlete mismatch, and omission of raw route/polyline/coordinates.

- [ ] **Step 2: Write failing projection tests**

Assert literal outputs for distance, moving/elapsed time, average pace, fastest kilometer, pace trend, available health metrics, identity/event context, and version `1`. Assert no rank, percentile, overtakes, chip result, route, coordinate, token, or raw payload keys.

- [ ] **Step 3: Verify RED**

Run: `npx vitest run tests/stravaClient.test.ts tests/stravaProjection.test.ts`

Expected: missing fields/module failures.

- [ ] **Step 4: Extend strict normalization**

Parse only the approved DetailedActivity fields. Cap split count and validate that each split is finite and internally plausible. Keep `startLatLng` only in ephemeral matching detail, never projection output.

- [ ] **Step 5: Implement pure projection**

Use selected Strava detail for every performance value. If metric splits are absent, return `splits: []` and no fastest/pace-trend insight. Derive average pace from moving time and activity distance; do not read chip tables.

- [ ] **Step 6: Verify GREEN**

Run the focused command from Step 3.

Expected: all client/projection tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/strava/client.ts lib/strava/projection.ts tests/stravaClient.test.ts tests/stravaProjection.test.ts
git commit -m "feat: project Wrapped from Strava activity"
```

---

### Task 8: Build snapshots through the existing worker

**Files:**
- Modify: `lib/strava/processing.ts`
- Modify: `lib/strava/store.ts`
- Modify: `app/api/internal/strava/process/route.ts`
- Modify: `tests/stravaProcessing.test.ts`
- Modify: `tests/api/runnerStrava.test.ts`
- Modify: `tests/sql/strava-processing.sql`

**Interfaces:**
- Consumes: `buildStravaWrappedProjection()`, selected normalized activity, Task 5 snapshot/job RPCs
- Produces: `enqueueStravaProjection(userId: string, runnerId: string, generation: string, activityId: string): Promise<void>` and worker transition from selected activity to `ready|failed` snapshot

- [ ] **Step 1: Write failing projection-job tests**

Cover automatic and explicit selection enqueueing exactly one job, building state before completion, ready snapshot commit, malformed projection failure, bounded retry, rate-limit delay, obsolete generation ignored, detach/disconnect during build, and webhook refresh rebuilding the same snapshot version.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/stravaProcessing.test.ts tests/api/runnerStrava.test.ts`

Expected: no projection job/snapshot behavior exists.

- [ ] **Step 3: Implement project-job handling**

Lease through the existing worker. Reload current connection, attachment, selection, registration context, and normalized activity before projecting. Commit only if all IDs/generation still match.

- [ ] **Step 4: Make selection transactional with building state**

Update the new selection RPC so selection, snapshot `building`, and projection-job enqueue are one database transaction. Use a new RPC name instead of overloading old signatures.

- [ ] **Step 5: Verify focused and SQL tests**

Run: `npx vitest run tests/stravaProcessing.test.ts tests/api/runnerStrava.test.ts && npm run test:native`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/strava app/api/internal/strava tests/stravaProcessing.test.ts tests/api/runnerStrava.test.ts tests/sql/strava-processing.sql
git commit -m "feat: build Strava Wrapped snapshots"
```

---

### Task 9: Replace the runner-facing Wrapped contract

**Files:**
- Modify: `lib/wrappedPayload.ts`
- Create: `lib/stravaWrappedService.ts`
- Modify: `app/api/runners/[runnerId]/wrapped/route.ts`
- Modify: `tests/api/wrapped.test.ts`
- Create: `tests/stravaWrappedService.test.ts`
- Modify: `lib/shareModel.ts`
- Modify: `tests/shareModel.test.ts`
- Modify: `lib/exportWrapped.ts`
- Modify: `tests/exportWrapped.test.ts`

**Interfaces:**
- Consumes: current user, direct runner ownership, attachment/import/selection/snapshot records
- Produces: `getStravaWrappedForUser(userId: string, runnerId: string): Promise<StravaFirstWrappedPayload>` with states `setup_required | authorizing | importing | needs_confirmation | no_match | building | ready | failed | reauth_required`

- [ ] **Step 1: Write failing service/API contract tests**

For every state, assert exact safe response keys and private/no-store headers. For `ready`, assert registration identity plus `StravaWrappedSnapshotV1` and optional BIB photos. Assert organizer-only access cannot receive a snapshot and chip controller functions are never called.

- [ ] **Step 2: Write failing share/export privacy tests**

Assert export uses Strava moving time/pace/splits and contains no chip rank, percentile, overtakes, coordinates, activity ID, athlete ID, or health metrics if the approved export remains non-health. Update that decision explicitly in the SRS if health metrics are intended for export.

- [ ] **Step 3: Verify RED**

Run: `npx vitest run tests/api/wrapped.test.ts tests/stravaWrappedService.test.ts tests/shareModel.test.ts tests/exportWrapped.test.ts`

Expected: old chip-first payload fails the new contract.

- [ ] **Step 4: Implement the stored-state service and route**

Do not call Strava or `getRunnerChipInput`. Load registration context, runner attachment state, safe candidates when owned, snapshot state, and optional BIB photos. Map missing or failed optional photos independently.

- [ ] **Step 5: Update share/export models**

Render only `ready` snapshots. Use honest absence copy when splits or metrics are missing.

- [ ] **Step 6: Verify GREEN**

Run the focused command from Step 3.

Expected: all new contract/privacy tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/wrappedPayload.ts lib/stravaWrappedService.ts lib/shareModel.ts lib/exportWrapped.ts app/api/runners tests/api/wrapped.test.ts tests/stravaWrappedService.test.ts tests/shareModel.test.ts tests/exportWrapped.test.ts
git commit -m "feat: serve Strava-first Wrapped payloads"
```

---

### Task 10: Expose claim and Strava actions in the runner dashboard

**Files:**
- Modify: `lib/runnerCatalog.ts`
- Modify: `app/components/useCatalog.ts`
- Create: `app/components/RunnerClaimForm.tsx`
- Create: `app/components/RunnerWorkflowCard.tsx`
- Modify: `app/components/RunnerSelection.tsx`
- Create: `tests/runnerWorkflow.test.tsx` or the repository's established server-rendered equivalent
- Modify: `tests/api/session.test.ts`

**Interfaces:**
- Consumes: Task 3 claim API and Task 9 workflow states
- Produces: catalog runner rows `{ id, name, bib_number, event, category, workflowState, primaryAction }`; claim form; exactly one primary Strava/Wrapped action per runner

- [ ] **Step 1: Write failing catalog and rendering tests**

Assert:

- no-runner account sees **Claim my registration** and not the old dead-end-only message;
- every linked runner shows one state-specific primary action;
- unconnected runner shows **Connect Strava**;
- active athlete but unattached runner shows **Use Strava for this race**;
- importing/building actions are disabled/status-only;
- ready runner shows **View Wrapped**;
- organizer-only runners do not receive runner Strava actions.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/runnerWorkflow.test.tsx tests/api/session.test.ts`

Expected: current catalog lacks workflow state and claim UI.

- [ ] **Step 3: Implement catalog workflow summaries**

Batch database reads by user and runner IDs. Do not call the provider. Return only safe display state; do not include activity/athlete IDs or tokens.

- [ ] **Step 4: Implement claim form and runner cards**

Claim submission posts the code once, clears it from component state on success, and reloads the catalog. Each card links to the runner setup page or ready Wrapped route according to state.

- [ ] **Step 5: Verify GREEN and accessibility basics**

Run the focused command from Step 2.

Expected: all pass; forms have labels, status/error roles, busy state, and keyboard-operable controls.

- [ ] **Step 6: Commit**

```bash
git add lib/runnerCatalog.ts app/components tests/runnerWorkflow.test.tsx tests/api/session.test.ts
git commit -m "feat: add runner claim and Strava dashboard actions"
```

---

### Task 11: Add the runner Strava setup experience

**Files:**
- Create: `app/runners/[runnerId]/strava/page.tsx`
- Create: `app/components/RunnerStravaSetup.tsx`
- Modify: `app/components/StravaCard.tsx`
- Modify: `lib/strava/viewModel.ts`
- Modify: `tests/stravaViewModel.test.ts`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: attach/connect/detach/disconnect routes and `GET/PUT /api/runners/[runnerId]/strava`
- Produces: focused consent/import/selection/build/retry/detach UI reachable directly from every runner card

- [ ] **Step 1: Write failing state/render tests**

Cover all states and actions from the design table, including consent copy for `activity:read_all`, candidate summaries, building progress, per-race detach versus account disconnect, and no controls for organizer-only access.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/stravaViewModel.test.ts`

Expected: new attach/detach/building actions and page are absent.

- [ ] **Step 3: Extend the pure view model**

Add action IDs `attach` and `detach` and state `building`. Keep request paths/methods explicit and same-origin.

- [ ] **Step 4: Implement the setup page/component**

Use native POST form navigation for OAuth, fetch actions for attach/check/confirm/detach/disconnect, abortable polling only for importing/building/disconnecting, and readable callback feedback removed from the URL.

- [ ] **Step 5: Verify GREEN**

Run: `npx vitest run tests/stravaViewModel.test.ts`

Expected: all state/action tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/runners app/components/RunnerStravaSetup.tsx app/components/StravaCard.tsx lib/strava/viewModel.ts tests/stravaViewModel.test.ts app/globals.css
git commit -m "feat: add per-runner Strava setup"
```

---

### Task 12: Render the Strava-only showcase

**Files:**
- Modify: `app/components/RecapStory.tsx`
- Modify: `app/components/SharePreview.tsx`
- Create: `app/components/StravaSplitChart.tsx`
- Modify: `app/wrapped/[runnerId]/page.tsx`
- Modify: `app/globals.css`
- Create: `tests/recapStravaFirst.test.tsx` or established server-rendered equivalent
- Modify: `tests/exportWrapped.test.ts`

**Interfaces:**
- Consumes: Task 9 `StravaFirstWrappedPayload` and snapshot fields
- Produces: ready-only seven-part showcase: intro; race summary; kilometer story; performance; activity context; optional photos; export

- [ ] **Step 1: Write failing showcase tests**

Assert visible Strava distance, moving/elapsed time, pace, fastest split/pace trend when present, optional health metrics, source attribution, photos, and export. Assert no rank, percentile, overtakes, chip finish state, route map, coordinates, private IDs, or placeholder zero metrics.

- [ ] **Step 2: Write failing non-ready routing tests**

Opening `/wrapped/[runnerId]` before `ready` must show the current workflow state and link to setup; it must not render a fabricated showcase.

- [ ] **Step 3: Verify RED**

Run: `npx vitest run tests/recapStravaFirst.test.tsx tests/exportWrapped.test.ts`

Expected: current chip-first slides fail the assertions.

- [ ] **Step 4: Implement the ready-only showcase**

Keep the approved palette and responsive story controls. Omit entire optional metric/split sections when absent. Add visible **Powered by Strava** attribution following current brand guidelines.

- [ ] **Step 5: Verify GREEN and build**

Run: `npx vitest run tests/recapStravaFirst.test.tsx tests/exportWrapped.test.ts && npm run build`

Expected: tests pass and Next.js production build exits 0.

- [ ] **Step 6: Commit**

```bash
git add app/components/RecapStory.tsx app/components/SharePreview.tsx app/components/StravaSplitChart.tsx app/wrapped app/globals.css tests/recapStravaFirst.test.tsx tests/exportWrapped.test.ts
git commit -m "feat: render Strava-first Wrapped showcase"
```

---

### Task 13: Add organizer claim and race-matching controls

**Files:**
- Modify: `app/components/OrganizerPanel.tsx`
- Create: `app/components/OrganizerRunnerAccess.tsx`
- Create: `app/components/OrganizerStravaRaceConfig.tsx`
- Create: `app/api/organizer/events/[eventId]/strava-config/route.ts`
- Create: `lib/strava/raceConfig.ts`
- Modify: `tests/api/organizer.test.ts`
- Create: `tests/organizerRunnerAccess.test.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: organizer claim route, existing `strava_race_configs`, event-scoped organizer guard
- Produces: linked/unlinked status, create/revoke claim actions, and organizer-managed category race window/distance tolerance/optional start-location configuration

- [ ] **Step 1: Write failing organizer API tests**

Cover event-scoped reads/writes, complete category config validation, timezone-bearing inclusive window, positive tolerance bounds, all-or-none location fields, allowed `Run` type, and denial for organizer of another event.

- [ ] **Step 2: Write failing organizer UI tests**

Assert linked/unlinked status without exposing Auth email, one-time code display, expiry, copy guidance, revoke action, and race-config success/error states.

- [ ] **Step 3: Verify RED**

Run: `npx vitest run tests/api/organizer.test.ts tests/organizerRunnerAccess.test.tsx`

Expected: claim/config controls are absent.

- [ ] **Step 4: Implement guarded config service/route and UI**

Validate server-side and store only event/category matching parameters. Never expose start coordinates in runner responses.

- [ ] **Step 5: Verify GREEN**

Run the focused command from Step 3.

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/components/OrganizerPanel.tsx app/components/OrganizerRunnerAccess.tsx app/components/OrganizerStravaRaceConfig.tsx app/api/organizer lib/strava/raceConfig.ts tests/api/organizer.test.ts tests/organizerRunnerAccess.test.tsx app/globals.css
git commit -m "feat: manage runner claims and Strava race context"
```

---

### Task 14: Verify the full local story

**Files:**
- Modify: `tests/integration/wrapped-flow.test.ts`
- Modify: `tests/integration/strava-lifecycle.test.ts`
- Create: `docs/qa/strava-first-runner-claims.md`
- Modify: `docs/qa/acceptance-matrix.md`

**Interfaces:**
- Consumes: complete implementation from Tasks 1–13
- Produces: repeatable integration evidence and a credential-gated real-provider runbook

- [ ] **Step 1: Add integration tests for account/claim/access flow**

Create disposable confirmed users and registrations. Verify unclaimed account, claim, catalog visibility, exactly one owner, organizer isolation, and cleanup.

- [ ] **Step 2: Add controlled-provider end-to-end tests**

Verify attach/connect callback, import, one/ambiguous/no match, confirmation, building, ready Wrapped, second registration reuse, duplicate-activity conflict, detach, account disconnect, and obsolete-generation suppression.

- [ ] **Step 3: Run all automated gates**

Run:

```bash
npm test
npm run test:native
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

Expected: every non-credential test passes; any documented optional skip names its missing prerequisite.

- [ ] **Step 4: Run dedicated Supabase integration tests**

After applying all migrations to the dedicated non-production project:

Run: `npm run test:db`

Expected: claim, authenticated flow, and Strava lifecycle/concurrency tests pass and disposable users/data are removed.

- [ ] **Step 5: Run database advisors**

Expected: no new health/security findings; performance findings are fixed or explicitly accepted with evidence.

- [ ] **Step 6: Execute manual browser acceptance**

At desktop and mobile widths, verify signup confirmation, claim, per-runner Strava action, consent return, candidate selection, progress states, ready showcase, export, detach, disconnect, keyboard focus, and no secret/private fields in browser storage/network/UI.

- [ ] **Step 7: Execute real Strava acceptance only when configured**

Use a private test athlete/activity and the dedicated project. Record app athlete-capacity, scopes, callback URL, webhook/scheduler state, provider outcomes, and cleanup without recording tokens, private coordinates, or raw activities.

- [ ] **Step 8: Commit verification evidence**

```bash
git add tests/integration docs/qa
git commit -m "test: verify Strava-first runner workflow"
```

---

### Task 15: Deploy migrations and runtime configuration

**Files:**
- No secret-bearing files committed
- Modify only non-secret deployment/runbook documentation if commands or environment names change

**Interfaces:**
- Consumes: verified migration set, Strava application credentials, Supabase/Vercel environment configuration, public callback domain
- Produces: operational non-production deployment ready for acceptance

- [ ] **Step 1: Confirm migration order and target**

List local and remote migrations. Verify the target is project `anbnuegocddoowagqmxw` or an explicitly approved replacement. The remote currently stops at `20261020020029_organizer_optional_aggregate`; therefore apply the six existing Strava migrations in order before the Task 2/5 migrations.

- [ ] **Step 2: Apply migrations to non-production and verify schema**

Use the Supabase CLI/MCP migration workflow appropriate to the environment. Verify migration history, functions, constraints, grants, RLS, and advisors after application.

- [ ] **Step 3: Configure runtime secrets outside Git**

Set `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, exact `STRAVA_CALLBACK_URL`, stable `STRAVA_ENCRYPTION_KEY`, `STRAVA_WEBHOOK_VERIFY_TOKEN`, `STRAVA_SUBSCRIPTION_ID`, and `STRAVA_PROCESS_SECRET`. Configure Supabase Site URL/redirect allowlist and SMTP for confirmation delivery.

- [ ] **Step 4: Register webhook and scheduler**

Verify the public webhook challenge, persist the returned subscription ID, and configure authenticated periodic worker POSTs within the host's execution limits.

- [ ] **Step 5: Bootstrap the first organizer and issue a test claim**

Use the Task 4 command; do not edit Auth metadata or public tables manually. Verify `/organizer`, claim creation, runner claim, and per-runner Strava action.

- [ ] **Step 6: Gate broader access**

Keep the app private/small until real-provider acceptance passes and Strava athlete capacity is sufficient. Submit Strava app review before exceeding the approved athlete count.
