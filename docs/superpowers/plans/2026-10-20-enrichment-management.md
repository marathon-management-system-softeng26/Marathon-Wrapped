# Enrichment and Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline; retain an independent review before completing this subsystem. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the optional-data and organizer backend around the verified chip recap before connecting the card UI.

**Architecture:** Reuse verified sessions, event/runner guards and the WrappedPayload contract. Organizer writes use a restricted atomic Postgres routine; optional provider calls stay outside baseline reads. OAuth state and credentials stay in a private schema accessible only through service-only routines.

**Tech Stack:** Existing Next.js, Supabase Auth/Postgres/Storage, TypeScript, Vitest.

**Spec:** [core-first design](../specs/2026-10-20-core-first-design.md); execution follows the user's October 20 authorization to continue and resolve backend clashes under documentation constraints.

**Progress:** Organizer chip management and sample-photo fixture work are implemented and verified. Optional-data management, Task 3 and complete-subsystem acceptance remain open. See [verification evidence](../../qa/core-foundation.md). The Figma preview is readable, but source/assets export requires access not yet available through the connected resource reader. No UI/Strava completion claim.

## Global constraints

- One demo event, 5K/10K, seeded timing, simulated manually BIB-matched photos; no payment/hardware/facial recognition.
- Free-tier services only. Never expose provider or service credentials in responses, images or committed files.
- Preserve the chip baseline when optional data is missing, denied, stalled or invalid.
- Verify authorization from a server session and mappings, never BIB or user-editable metadata.

## Review focus

- An organizer mapped to another event cannot read or save this event.
- Any rejected aggregate save rolls back earlier writes, including deleted/replaced splits.
- Category changes replace timing/splits in the same transaction; assigned BIBs stay immutable.
- Seed/demo metrics are distinct from live OAuth connections; missing provider fields remain null.
- Provider denial, expiry and disconnect failure must not expose tokens or falsely report success.

## Task 1: Event results and transactional hero saves

Files: `controllers/organizerController.ts`, `lib/heroValidation.ts`, `app/api/organizer/events/[eventId]/results/route.ts`, `app/api/organizer/events/[eventId]/runners/route.ts`, `app/api/organizer/events/[eventId]/runners/[runnerId]/route.ts`, one CLI-generated migration, `tests/organizer.test.ts`, `db/tests/organizer.sql`.

Interfaces: `getEventResults(userId: string, eventId: number)` returns public result summaries including missing-result runners. `saveHeroRunner(userId: string, eventId: number, runnerId: string | null, draft: HeroRunnerDraft)` returns `{runner_id: string}`. `HeroRunnerDraft` contains category name, immutable BIB/name/DOB/gender/consent, nullable timing result and splits; optional metrics/photo changes are explicit. A service-only `save_hero_runner` RPC validates event/category and atomically writes the aggregate. New demo registration contact/ID fields are synthetic, not a claim of real registration.

- [ ] Write tests for wrong-event access, malformed draft, DNF/DNS/null timing, category mismatch, duplicate BIB, source error redaction, no-result inclusion and immutable BIB. Observe failures before implementation.
- [ ] Implement validated service/controller/HTTP boundaries with private/no-store responses, origin checks on cookie-authenticated writes, stable 400/401/403/404/409/422/503 states and same-event authorization.
- [ ] Generate and implement a migration for the atomic RPC. Restrict execution to service_role; fix search_path. Use generated IDs and recheck target event in the routine. Replace dependent chip data before a category move within the same transaction. Derive elapsed/pace from timestamps and preserve optional data unless explicitly replaced.
- [ ] Add SQL assertions proving rollback after a late split error, duplicate BIB and mismatched event rejection, successful create/update and category movement. Apply to the dedicated project, verify and roll back QA fixtures.
- [ ] Run unit/API tests, lint/typecheck/build and commit the verified management increment.

## Task 2: Actual sample-photo fixtures

Files: photo source/provenance record and assets, `db/seed.sql`, storage configuration migration where needed, enrichment tests.

- [ ] Use supplied design assets or clearly attributed reusable sample race photos. Verify actual file contents/dimensions; no missing or temporary URLs.
- [ ] Manually map usable photo records to all three hero BIBs. Keep `EDGE-NO-PHOTOS` empty and photo/metric errors nonblocking.
- [ ] Assert all returned photos match the requested BIB and that complete hero fixtures have chip, demo metrics and usable photo assets. Verify seed repeatability and export-safe access.

## Task 3: Real Strava lifecycle

Files: `lib/strava/` modules, connect/callback/activity-selection/disconnect routes, private credential/state schema plus service-only RPCs, focused provider/route tests.

- [ ] Read current official Strava OAuth, activity and rate-limit documentation; pin scopes and field units before code.
- [ ] Test single-use expiring user/runner-bound OAuth state, explicit connect, denied/mismatched callbacks, activity date/distance filtering, missing metrics, token refresh, 429/timeouts and failed remote revocation before implementation.
- [ ] Implement code exchange and refresh entirely server-side. An explicit compatible-activity selection stores metrics; do not silently pick the latest activity. Never make provider network calls while reading the baseline.
- [ ] Disconnect hides local metrics immediately, removes normal access to credentials and records bounded retry if remote deauthorization fails. Report pending remote retry honestly.
- [ ] Run mocked provider/route checks and live tests when the user's Strava app credentials/authorization are available. Missing credentials leave a clear disconnected/unavailable state; mocked success is not real OAuth evidence.

## Task 4: Subsystem acceptance

- [ ] Run all core/database/management/integration checks after changes and verify no cross-runner or token exposure.
- [ ] Fresh independent review; important findings receive failing regressions, one fix pass and a green full suite/build.
- [ ] Update evidence and hand off stable interfaces to the Figma/Impeccable UI plan. Record pending external OAuth validation separately; do not mark the entire goal complete.
