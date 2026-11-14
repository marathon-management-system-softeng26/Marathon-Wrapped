# Strava-First Runner Claims Design

**Date:** November 11, 2026\
**Status:** Approved\
**Supersedes:** The chip-first baseline and optional-Strava product decision in `PRODUCT.md` and `docs/SRS_v4.md`

## Intent

Make Strava the required source for generating a runner's Wrapped showcase. A person first creates and confirms an application account, securely claims a race registration prepared by an event organizer, and then explicitly connects their Strava athlete account for that registration. The application creates the Wrapped showcase only after it has imported and selected a qualifying Strava race activity.

The race registration still supplies trusted event context: runner identity, BIB, event, category, race date, and expected distance. It does not supply showcase performance statistics. Timing, pace, splits, and health/activity metrics shown in Wrapped come from the selected Strava activity.

## Goals

- Give every claimed runner registration a clear Strava action on the runner dashboard.
- Prevent signup alone, a public BIB, or editable user metadata from granting runner or organizer access.
- Let an organizer create one-time claim credentials for registrations in only their mapped event.
- Let one application account claim multiple registrations.
- Let one active Strava athlete connection generate separate Wrapped showcases for multiple registrations owned by the same application account.
- Generate and persist a privacy-minimized Wrapped snapshot only after a qualifying activity is selected.
- Preserve explicit consent, scope validation, encrypted rotating credentials, activity confirmation, disconnect, and failure recovery.
- Give operators an explicit, auditable way to bootstrap event-organizer access.

## Non-goals

- Public BIB lookup or public personalized recap links.
- Automatic linking based only on email address.
- Letting users create trusted event registrations themselves.
- Global platform-admin UI, organization management, payments, or race registration commerce.
- Calculating event rank, overtakes, or cohort comparisons from one athlete's Strava data.
- Calling Strava during ordinary Wrapped reads.
- Importing arbitrary activity history outside claimed race windows.
- Keeping live Strava-derived snapshots after the runner disconnects.

The existing chip schema, organizer result editor, and chip tests remain temporarily as legacy operational functionality for rollback and historical data. They stop contributing to runner-facing Wrapped output. Deleting that subsystem is a separate cleanup project after Strava-first acceptance, avoiding an irreversible data migration in the same release.

## Approaches considered

### Selected: organizer-issued, single-use runner claim

An event organizer creates a time-limited claim code for an existing registration. After signup and email confirmation, the runner submits the code. The server atomically consumes it and creates `runner_access`. This keeps event context trusted and makes possession of a BIB insufficient for access.

### Rejected: verified-email auto-link

Matching the confirmed Auth email to `runners.email` is convenient but fragile. Registration typos, shared addresses, and email changes create recovery and takeover risks. It also exposes whether an email has a registration.

### Rejected: runner-created race context

Allowing a new user to enter their own BIB, event, and category removes organizer work but makes trusted event context user-controlled. That weakens event ownership, photo matching, and future event validation.

## Roles and authorization

There is no self-assignable or global `admin` role.

- **Runner:** a verified Supabase Auth user with one or more rows in `runner_access`.
- **Organizer:** a verified Supabase Auth user with an event-specific row in `organizer_access`.
- **Operator:** a trusted maintainer with server credentials who can run the organizer-bootstrap script. This is operational authority, not a browser role.

Authorization continues to use server-owned tables, never `user_metadata`. Browser clients receive no direct grants to claim, access, token, or Strava tables. Organizer access to an event does not grant access to a runner's Strava athlete data; only direct `runner_access` does.

## Organizer bootstrap and access

Add `scripts/grant-organizer.mts`. It requires the dedicated project URL/ref, a confirmed Auth email, and an exact event identifier. It resolves the user and event and upserts `organizer_access`. It prints identifiers and success state but never credentials or service keys.

After login, `/api/session` returns organizer events. The home page exposes **Manage event results** only when at least one event is mapped. `/organizer` remains guarded server-side, so entering the URL manually cannot bypass the mapping.

## Claim data model

Add a service-only `runner_claims` table:

- `id uuid primary key`
- `runner_id uuid not null references runners(id) on delete cascade`
- `event_id bigint not null references events(id) on delete cascade`
- `token_hash text not null unique`
- `created_by uuid not null references auth.users(id)`
- `created_at timestamptz not null`
- `expires_at timestamptz not null`
- `claimed_by uuid null references auth.users(id)`
- `claimed_at timestamptz null`
- `revoked_at timestamptz null`

The raw claim token is generated with at least 256 bits of cryptographic randomness and is returned only once. Only its SHA-256 hash is stored. Claims expire after seven days, can be revoked by an organizer for the same event, and can be consumed once.

An atomic service-only database function consumes a valid unexpired claim, verifies that the runner belongs to the recorded event, prevents a different account from owning an already-claimed registration, inserts `runner_access`, and records `claimed_by/claimed_at`. One account may own multiple runners, but each runner has at most one direct runner owner.

## Account and claim workflow

1. Organizer creates or imports a runner registration.
2. Organizer selects **Create claim code** beside that runner.
3. The application shows the raw code once with expiry and copy guidance.
4. Runner creates an account and confirms their email.
5. Runner signs in.
6. If no registration is linked, the dashboard presents **Claim my registration** instead of only the current dead-end message.
7. Runner submits the claim code through a same-origin POST.
8. The server atomically consumes the claim and creates `runner_access`.
9. The dashboard reloads and shows the claimed registration.

Invalid, expired, revoked, already-used, or cross-event claims return non-enumerating messages. Retrying a claim already consumed by the same user is idempotent.

## Runner dashboard workflow

Each linked registration has one primary state and action:

| State | Primary action |
| --- | --- |
| No Strava athlete connection | **Connect Strava** |
| Athlete connected, registration not attached | **Use Strava for this race** |
| Authorization in progress | **Continue/Cancel connection** |
| Import running | **Check activity import** |
| Several qualifying activities | **Choose race activity** |
| No qualifying activity | **Retry after uploading to Strava** |
| Selected activity being projected | **Building your Wrapped** |
| Snapshot ready | **View Wrapped** |
| Reauthorization required | **Reconnect Strava** |

The direct Strava action is available on every runner card. The recap route is not the only place where a runner can discover connection. A runner can also open the Strava setup screen for detailed consent, candidate selection, retry, and disconnect controls.

## Strava connection model

Keep one encrypted Strava connection per application user because OAuth authorizes an athlete account, not a race registration. Replace the current one-runner-per-generation restriction with explicit runner attachments under that connection:

- A new OAuth consent creates or refreshes the user's athlete connection.
- Selecting **Use Strava for this race** creates a runner-scoped opt-in attachment after verifying direct `runner_access`.
- Each attachment has its own race-window import, candidates, selected activity, build state, and snapshot.
- The same athlete connection may support multiple claimed registrations for different races.
- A runner attachment never grants access to another claimed runner.
- Disconnecting the Strava account disables all attachments, deletes all live snapshots/candidates, and revokes provider credentials.

Continue using OAuth authorization code flow with an unpredictable state, exact callback URL, granted-scope validation, encrypted access/refresh tokens, rotating refresh-token persistence, athlete-ID verification, and the current recommended Strava revoke endpoint. Request `activity:read_all` because a runner may select an activity whose visibility is Only You; explain this before consent.

## Activity import and selection

For each attached registration, use trusted event/category context to define an inclusive race time window and expected distance. Organizers manage the category-level Strava race window, allowed sport types, distance tolerance, and optional start-location constraint from the event management screen; saves are event-scoped and server-validated. Import only the authenticated athlete's activities within that bounded window. A candidate must:

- belong to the connected athlete;
- have sport type `Run`;
- fall inside the configured race window; and
- be within the configured distance tolerance.

Automatically select only one fully qualifying candidate when the configured location check also passes. Otherwise, show privacy-minimized candidate summaries and require the runner to confirm. Provider activity IDs remain private account data and are exposed only to that owner for explicit selection.

Within one user connection generation, a Strava activity can be selected for at most one claimed registration. This prevents one activity from generating several race showcases when windows overlap. A conflict asks the runner to choose a different activity or detach the earlier registration.

## Strava-first Wrapped projection

Extend the normalized selected-activity record to include only fields required by the showcase:

- activity ID and athlete ID for ownership checks;
- start time and sport type;
- distance;
- moving time and elapsed time;
- average and maximum speed when present;
- metric kilometer splits when present;
- average/max heart rate, elevation gain, calories, and average cadence when present.

Validate all provider fields before persistence. Missing optional values remain null; they are never invented. Derive display pace and fastest/slowest split from the normalized selected activity, not from chip tables.

Create a versioned `strava_wrapped_snapshots` record keyed by runner, user, connection generation, and selected activity. It stores the validated, presentation-safe projection required by the UI and its build status (`building`, `ready`, `failed`). Token values, raw provider payloads, routes, coordinates, and private athlete profile data never enter the snapshot.

The Wrapped API returns a stateful response:

- `setup_required` before a runner attachment exists;
- `importing` while activity data is being fetched;
- `needs_confirmation` when the runner must choose;
- `building` while projection is being committed;
- `ready` with the Strava-derived showcase;
- `failed` with a retry path.

The visual showcase renders only for `ready`. Identity, event, BIB, category, and optional BIB-matched photos may still come from the trusted registration. Remove chip-derived finish time, pace, rank, split insights, overtakes, and percentile claims. Event/category rank is unavailable unless a future organizer-approved cohort source is added.

## Worker and read behavior

OAuth callbacks enqueue work and redirect immediately. The existing authenticated worker imports activities, fetches selected detail, validates it, commits runner-scoped candidates/selections, and builds the safe snapshot. Webhooks enqueue refreshes for attached runners. Ordinary dashboard and Wrapped reads use stored state only and never wait on Strava.

Rate-limit responses retain queued work with bounded retry/backoff. The UI keeps the runner in an honest importing or retry state. The design must respect Strava athlete-capacity and request limits; development starts with a private test athlete, then the app-access review is completed before a broader demonstration.

## Failure and recovery

- Denied or insufficient OAuth scope: return to setup with an explanation and retry action.
- No match: keep the attachment and allow retry after the runner uploads/corrects their Strava activity.
- Multiple matches: require explicit selection.
- Expired access token: refresh using the latest rotating refresh token.
- Lost/invalid refresh credentials: require reauthorization.
- Snapshot validation/build failure: preserve the selected candidate, expose retry, and show no fabricated Wrapped.
- Detach one registration: delete that registration's attachment, candidates, selection, and snapshot while retaining the user's athlete connection for their other registrations.
- Disconnect Strava account: immediately hide/delete all live showcase snapshots and attachments for that user, then retry remote revocation durably if necessary.
- Deleted account or registration: cascade access, attachments, candidates, snapshots, and claim records as appropriate.

## UI changes

- Replace the empty dashboard dead end with a claim-code form and concise organizer guidance.
- Split each runner row into registration identity, Strava/Wrapped status, and primary action.
- Add a focused runner setup screen or stateful panel for consent, import progress, candidate selection, retry, and disconnect.
- Keep organizer-only claim creation in `/organizer`; never show result-management controls to runners.
- Keep callback feedback readable and remove OAuth result parameters from the URL after display.
- Make unavailable metrics disappear rather than display zeros.

## Migration and rollout

1. Update product/SRS documentation to record that Strava-first replaces chip-first behavior.
2. Add claim, attachment, and snapshot migrations with RLS enabled, no browser grants, explicit service-role grants, bounded indexes, and atomic service functions.
   Add the one-owner constraint to `runner_access` only after a preflight query proves no runner has multiple owners; otherwise fail and require explicit manual resolution. The current dedicated project has no duplicate runner owners as of November 11, 2026.
3. Apply and verify the six existing Strava migrations on a dedicated non-production Supabase project before applying the new migration.
4. Configure the Strava client ID/secret, exact callback URL, stable encryption key, worker secret, webhook verification token, subscription ID, and scheduler.
5. Bootstrap an organizer with the server-only script.
6. Run account claim, OAuth, activity matching, snapshot, disconnect, and cross-account authorization tests.
7. Perform real-provider acceptance with private synthetic/test activities before enabling additional athletes.

No schema migration or provider configuration is applied merely by approving this design.

## Verification expectations

- Unit/API tests for claim creation, hashing, expiry, revocation, idempotency, and cross-event denial.
- Authorization tests proving organizer access cannot read or mutate athlete data.
- Migration tests proving one direct owner per runner and safe cascading cleanup.
- OAuth tests for state, exact callback, scope denial, athlete mismatch, token rotation, and multiple runner attachments.
- Controlled-provider tests for no match, one match, ambiguous matches, partial fields, invalid fields, rate limits, and refresh.
- Projection tests proving all showcase values derive from the selected normalized Strava activity and no chip statistic leaks into output.
- UI tests for each dashboard state and one visible Strava action per linked runner.
- End-to-end tests for signup/confirmation, claim, connect, select, build, view, retry, and disconnect.
- Security/performance advisors and a final check that no service keys, OAuth tokens, raw activity payloads, or coordinates appear in responses, logs, exports, or committed files.
