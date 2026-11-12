# Strava Integration Branch Design

## Intent

Finish the real Strava requirements without rewriting or advancing either source branch. The existing `dev` branch supplies the current application and Figma refresh. The existing `strava-integration` branch supplies its OAuth, token, webhook, worker, migration, and test history. All merge resolution and completion work happens on a new `integration` branch in its own worktree.

## Goals

- Create `integration` from the current `origin/dev` tip.
- Merge `origin/strava-integration` with a true merge commit so both histories remain visible.
- Never force-push, rebase, reset, delete, or commit directly to `dev` or `strava-integration`.
- Resolve the revert-derived Strava conflicts deliberately while retaining the current `dev` UI and application behavior outside the Strava surface.
- Complete voluntary OAuth connection, race-activity selection, metric enrichment, failure fallback, and disconnection required by SRS FR-08 through FR-11.
- Integrate Strava controls into the refreshed recap UI and retain the baseline recap when Strava is absent or fails.
- Verify unit, API, native, database, provider-sandbox/manual, build, type, lint, responsive, privacy, and acceptance behavior before proposing integration into another branch.

## Non-goals

- No changes to the tips or histories of `dev` and `strava-integration`.
- No automatic social posting, public recap links, multi-event support, live timing hardware, or facial recognition.
- No unrelated redesign beyond adapting the current `dev` Strava card to the required states and controls.
- No deployment to production or remote database migration without explicit authorization and configured credentials.
- No registration-scope decision in this project; the registration work already present on `dev` is preserved as source state but not expanded.

## Anti-goals

- Do not mark sample metrics as live Strava data.
- Do not start OAuth during ordinary recap loading.
- Do not allow a Strava failure to block chip results, photos, or export.
- Do not attach an activity merely because it is the nearest or most recent when multiple candidates are plausible.
- Do not expose client secrets, access tokens, refresh tokens, encryption keys, or worker secrets to browser payloads, logs, or exports.
- Do not claim completion while matching still returns `501`, the UI lacks controls, or live-provider acceptance has not run.

## Constraints

- Base branch: current `origin/dev` at workspace-creation time.
- Merge source: current `origin/strava-integration` at workspace-creation time.
- Target branch name: exactly `integration`, as requested.
- Workspace: a new isolated managed worktree; the current detached worktree remains a read-only planning workspace except for this design and its implementation plan.
- Merge strategy: `git merge --no-ff origin/strava-integration`; no squash, rebase, or cherry-pick replacement for the source merge.
- Existing stack remains Next.js 16, React 19, TypeScript, Supabase/Postgres, Vitest, and the Strava V3 API.
- OAuth and token operations are server-only. Tokens remain encrypted at rest.
- Runner access and organizer access continue to use the existing verified Supabase session and server-owned mappings.

## Approaches Considered

### Selected: isolated merge branch preserving both histories

Create `integration` from `origin/dev`, merge `origin/strava-integration`, resolve conflicts there, and finish the feature in follow-up commits. This preserves both source branches exactly and provides a reviewable record of the merge and subsequent repairs.

### Rejected: rebase Strava onto dev

This would create a linear history, but it would rewrite the Strava commits and violate the requirement to preserve that branch.

### Rejected: cherry-pick selected Strava commits

This could reduce merge conflicts, but would omit the original branch relationship and make it harder to prove which source work was incorporated.

## Workspace and Git Flow

1. Fetch all refs and verify `dev`, `strava-integration`, and the requested `integration` name.
2. Refuse to overwrite an existing `integration` branch or worktree; inspect and report it instead.
3. Create a managed worktree at `origin/dev`, then create local branch `integration` in that worktree.
4. Install dependencies and run the `dev` baseline suite before merging.
5. Merge `origin/strava-integration` with `--no-ff`.
6. Resolve conflicts using the rules below, run a merge-level test gate, and commit the merge.
7. Finish the missing Strava behavior through test-driven follow-up commits on `integration` only.

## Conflict Resolution Policy

- For non-Strava UI and shared application files, preserve `dev` behavior unless a Strava interface requires an explicit adaptation.
- For files under `lib/strava`, Strava routes, and the Strava lifecycle migration, start from the `strava-integration` version, then repair it rather than silently accepting either side.
- Keep `dev`'s refreshed `RecapStory`, CSS, login, registration, export, and decoration behavior; add Strava controls as a bounded component instead of replacing the refreshed screen.
- Reconcile README and product documentation manually: retain current setup and UI instructions, add complete Strava configuration and operational limits, and remove statements that become false.
- Preserve the disconnected demo-metric labeling and existing chip/photo fallback behavior.
- Treat the current `matching.ts` TODO, `confirmRunnerStravaActivity()` HTTP 501, and missing UI controls as known incomplete work, not merge-resolution successes.

## Runtime Design

### Connection

The runner explicitly selects Connect on their authorized recap. A same-origin server route creates a cryptographically random state, binds it to the authenticated user and a short-lived HTTP-only cookie, and redirects to Strava. The callback validates the state, session, granted scope, athlete identity, and provider response before encrypted credentials become active.

### Activity discovery and matching

After authorization, the system imports activities only within the configured Soekarno Run race window. Candidate validation uses sport type, UTC start window, category distance tolerance, and start-location radius when GPS is available. Exactly one strong candidate may be selected automatically; zero candidates produce a no-match state; ambiguous or location-incomplete candidates require explicit runner confirmation. Candidate activity IDs are server-owned, and confirmation rechecks runner access and candidate ownership.

Matching configuration is stored per race category. The initial allowed sport type is `Run` and the fixed distance tolerance is ±500 meters. Start coordinates and radius are nullable because the repository does not yet contain an approved start point: while either is absent, candidates may be offered for confirmation but are never attached automatically. Automatic selection requires exactly one candidate that passes every configured check, including GPS location. QA may temporarily use a clearly labeled test-only race window that matches a private test activity; private coordinates and activity details are not committed, and the Soekarno Run configuration is restored after acceptance.

### Metrics

For the confirmed race activity, the server stores only the required recap metrics: average heart rate, maximum heart rate, elevation gain, calories, and average cadence, plus provenance identifying it as live Strava data. Missing fields remain null and are not invented. The existing Wrapped enrichment pipeline reads these values independently of chip results and photos.

### Webhooks and workers

The source branch's webhook, encrypted token rotation, durable queue, retry, and revocation architecture is preserved. Completion work connects the existing job system to race configuration, candidate persistence, selection, and metrics materialization. A configured scheduler processes jobs; ordinary recap reads never call Strava directly. If operational configuration is absent, the UI reports an unavailable/disconnected state while the baseline recap remains usable.

### Disconnection

Disconnect immediately disables local ingestion and removes live metrics from the recap. Remote token revocation is attempted and durably retried when needed. The UI distinguishes disconnected, disconnecting, and reauthorization-required cleanup states; it never reports success before local disconnection is committed.

### UI states

The refreshed Strava recap card supports: disconnected, authorizing, connected/importing, needs confirmation, no matching activity, connected with complete or partial metrics, temporarily unavailable, disconnecting, and reauthorization required. All states retain navigation to chip results, photos, and export. Query-string callback outcomes are converted into readable feedback and then removed from the visible URL.

## Data and Interfaces

- Extend the lifecycle migration with race configuration and per-user activity candidate/selection storage rather than overloading `strava_metrics`.
- Bind each OAuth attempt to one authorized `runner_id` and a server-validated return path so accounts linked to multiple runners cannot enrich the wrong recap.
- Maintain at most one active Strava connection per authenticated user and at most one selected race activity per authorized runner.
- Keep provider activity details and route geometry private; the runner-facing API returns only candidate summaries needed for informed confirmation and selected-state data.
- Extend the existing Wrapped payload Strava state without changing baseline chip-stat interfaces.
- Make database writes idempotent across repeated callbacks, duplicate webhook deliveries, worker retries, and repeated confirmation.
- Preserve seeded demo metrics separately from live selected-activity metrics; prefer live data only while an active selection exists and restore labeled demo data after disconnect.
- Preserve Strava's `average_cadence` value without an invented conversion. The official activity schema does not define a display unit; live UI copy uses “Strava cadence” rather than `spm` until a verified unit rule is approved. Seeded demo cadence retains its existing labeled-demo treatment.

## Error Handling

- Provider denial or cancelled consent returns to the recap with baseline data intact.
- Invalid/expired state, athlete mismatch, missing scopes, malformed provider responses, and cross-origin mutations fail closed.
- Rate limits honor `Retry-After`; transient jobs retry with bounded backoff; permanent validation errors stop retrying and expose a safe user state.
- Failed refresh marks reauthorization required without leaking credentials or deleting chip data.
- Unknown, stale, or foreign activity confirmation is rejected and cannot alter another runner.
- Disconnect failure leaves local ingestion disabled and schedules remote cleanup.

## Verification

- Unit tests for configuration, matching boundaries, state transitions, provider parsing, encryption, token refresh, and error mapping.
- Route tests for connect, callback, candidate listing/confirmation, webhook verification, worker authentication, and disconnect.
- Database tests for ownership, uniqueness, atomic selection, idempotency, stale generations, duplicate events, retries, revocation, and cleanup.
- Integration tests with controlled Strava HTTP fixtures for consent success/denial, partial metrics, rate limiting, refresh, ambiguity, confirmation, and disconnect.
- Manual sandbox acceptance using a real Strava application and synthetic/private test activity; no personal secrets or activity details enter repository artifacts.
- Regression gates: existing 88 unit/API tests, 10 native tests, live Supabase suite when configured, lint, TypeScript, production build, export checks, and responsive runner journeys.

## Completion Criteria

- `integration` contains a merge commit with both `origin/dev` and `origin/strava-integration` ancestry.
- Both source branch tips remain unchanged.
- A runner can explicitly authorize Strava, import or confirm the correct race activity, see available live metrics, and disconnect.
- Denial, no match, ambiguous match, partial data, rate limits, refresh failure, and remote cleanup do not block the baseline recap.
- The previous TODO matching behavior and HTTP 501 confirmation path are removed.
- Required automated gates pass, live-provider acceptance is recorded, and remaining operational prerequisites are documented.
