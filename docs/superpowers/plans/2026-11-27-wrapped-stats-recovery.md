# Wrapped Stats Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the official ScoreNow result, complete checkpoint data, persisted personal photos, and a stable first paint the source of truth for Wrapped while keeping Strava optional and outside the story.

**Architecture:** Keep authorization and official-result assembly on the server, but pass the authenticated payload into the Wrapped client as initial state. Normalize official checkpoints into a shared split-row view model that preserves source labels and values; use the same model for the story and export. Keep Strava/photo mutations and refreshes as explicit client operations, with optional-photo failures represented separately from official stats failures.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase/Postgres, Vitest, private Supabase Storage routes.

**Spec:** `docs/superpowers/specs/2026-11-27-wrapped-stats-recovery-design.md`

## Global Constraints

- Official `official_race_results` and `official_race_checkpoints` data is the source of truth for a published ScoreNow recap.
- Strava is optional enrichment; a disconnected runner still receives a complete official Wrapped.
- Preserve private runner/photo authorization and do not expose service-role credentials, provider identifiers, health data, or private registration fields.
- Display every published official checkpoint row in sequence; never synthesize checkpoint kilometer numbers from array indexes.
- Use tests-first for every production behavior change and run the full Vitest suite before completion.

## Review Focus

- Authenticated official result with no Strava: server-seeded Wrapped renders immediately and remains complete.
- Three ready/included personal photos: photo merge is runner-scoped and survives a second Wrapped open.
- Missing or partial checkpoint values: labels, elapsed time, and split time remain accurate without fabricated zeros.
- Strava states changing after initial render: refresh updates only optional enrichment and never removes official stats.
- Legacy database without official-result tables: existing fallback remains available while the new path is additive.

---

### Task 1: Lock the official Wrapped payload and checkpoint view model

**Files:**
- Modify: `lib/wrappedPayload.ts`
- Modify: `lib/officialWrappedService.ts`
- Modify: `lib/recapViewModel.ts`
- Create: `tests/officialWrappedViewModel.test.ts`
- Modify: `tests/officialWrappedService.test.ts`

**Interfaces:**
- Consumes: `OfficialWrappedPayload.result.checkpoints` from `official_race_checkpoints`.
- Produces: a typed official split/checkpoint row with `sequence`, `label`, `distanceMeters`, `displayedTimeMs`, and `reportedSplitMs`, plus a single normalization function used by UI and export.

- [x] **Step 1: Write failing tests** for preserving all checkpoint rows in sequence, retaining ScoreNow labels such as `Checkpoint 1 - KM 3.7`, and keeping null displayed/split values null.
- [x] **Step 2: Run the focused tests** with `npm test -- --run tests/officialWrappedViewModel.test.ts tests/officialWrappedService.test.ts`; confirm the new assertions fail for the current synthetic-index behavior.
- [x] **Step 3: Implement the smallest shared checkpoint normalization contract** and update the official service typing/query mapping without changing database rows or Strava payloads.
- [x] **Step 4: Run the focused tests** and confirm they pass.
- [x] **Step 5: Commit** with `git add lib tests && git commit -m "fix: preserve official wrapped checkpoints"`.

### Task 2: Server-seed the Wrapped route and preserve refresh behavior

**Files:**
- Modify: `app/wrapped/[runnerId]/page.tsx`
- Modify: `app/components/RecapStory.tsx`
- Modify: `app/api/runners/[runnerId]/wrapped/route.ts`
- Create or modify: `tests/recapStory.test.tsx`

**Interfaces:**
- Consumes: the authenticated payload from `getOfficialWrappedForUser`/`getStravaWrappedForUser` and the checkpoint model from Task 1.
- Produces: `RecapStory({ runnerId, initialPayload })` with the initial payload rendered before client refresh; refresh requests remain abortable and explicit.

- [x] **Step 1: Write failing component tests** for rendering official stats from `initialPayload` without a fetch, retaining all checkpoint rows, and showing a loading state only when no initial payload exists.
- [x] **Step 2: Run the focused component tests** and verify the current client-only component fails the no-fetch assertion.
- [x] **Step 3: Load the payload in the App Router page after authentication/access verification**, pass it to `RecapStory`, and reconcile the client fetch so it does not replace a valid initial payload with a blank loading state.
- [x] **Step 4: Replace the synthetic `index + 1` chart mapping with the shared official checkpoint model** and render every row in sequence, including source label and available elapsed/split values.
- [x] **Step 5: Add a safe private response policy**: keep personalized API responses non-public, but remove the unnecessary duplicate initial loading round trip; use revalidation only where it cannot leak one runner's payload to another.
- [x] **Step 6: Run focused component/API tests and the full suite**; confirm the official payload remains available when optional enrichment is slow or unavailable.
- [x] **Step 7: Commit** with `git add app lib tests && git commit -m "fix: seed wrapped stats from official result"`.

### Task 3: Move Strava controls out of the Wrapped story

**Files:**
- Modify: `app/components/RecapStory.tsx`
- Modify: `app/components/RacePassCard.tsx`
- Modify: `app/runners/[runnerId]/strava/page.tsx` if needed after inspection
- Modify: `tests/runnerWorkflow.test.ts`
- Modify or create: `tests/recapStory.test.tsx`

**Interfaces:**
- Consumes: official payload availability and existing Strava route/view-model actions.
- Produces: a no-Strava official story with a separate navigation link to Strava setup; no connect form/button inside `RecapStory`.

- [x] **Step 1: Write failing tests** that assert a disconnected official recap has no Strava connect form/button, still has official context copy, and exposes the separate Strava route from the dashboard or dedicated setup page.
- [x] **Step 2: Run the focused tests** and confirm the current context slide contains `StravaCard`/connect controls.
- [x] **Step 3: Remove the in-story Strava control rendering** while preserving optional status feedback and official stats; keep dashboard/Strava-page actions intact.
- [x] **Step 4: Verify all workflow states** (setup, authorizing, importing, confirmation, building, failed, reauth) still have a recoverable destination outside Wrapped.
- [x] **Step 5: Run focused and full tests** and commit with `git add app tests && git commit -m "fix: keep strava setup outside wrapped"`.

### Task 4: Make selected personal photos reliable in the server-seeded payload

**Files:**
- Modify: `app/api/runners/[runnerId]/wrapped/route.ts`
- Modify: `lib/runnerPhotos/wrapped.ts`
- Modify: `lib/runnerPhotos/service.ts` only if the read contract needs correction
- Modify: `tests/runnerPhotoWrapped.test.ts`
- Create or modify: `tests/api/wrapped.test.ts`

**Interfaces:**
- Consumes: `runner_uploaded_photos` ready/included rows and the private content route.
- Produces: an official/ready payload containing runner-scoped personal `Photo` entries before organizer photos, with a diagnostic-safe optional-photo status.

- [x] **Step 1: Write failing integration-style tests** for a ready/included upload appearing after a fresh Wrapped request and for a non-ready/failed optional photo read not hiding official stats.
- [x] **Step 2: Run the focused tests** and verify the current silent `null` fallback cannot distinguish “no included photos” from “photo read failed.”
- [x] **Step 3: Make the merge/load path deterministic and runner-scoped**, preserving the current private URL route and avoiding any public Storage bucket change.
- [x] **Step 4: Add a client-visible retry/notice path** for optional photo load failure while keeping the official recap renderable.
- [x] **Step 5: Run the focused and full test suites** and commit with `git add app lib tests && git commit -m "fix: recover selected photos in wrapped"`.

### Task 5: Align the PNG export and acceptance coverage

**Files:**
- Modify: `lib/shareModel.ts`
- Modify: `lib/exportWrapped.ts`
- Modify: `tests/exportWrapped.test.ts`
- Modify: `tests/recapViewModel.test.ts`
- Modify: `docs/qa/acceptance-matrix.md`

**Interfaces:**
- Consumes: the shared official checkpoint model from Task 1.
- Produces: consistent on-screen/export timing and checkpoint labels, with any canvas row limit explicit in copy and tests.

- [x] **Step 1: Write failing export tests** for all official checkpoints being normalized correctly and for null checkpoint values not becoming `0:00`.
- [x] **Step 2: Run focused export tests** and confirm the current export path either omits official checkpoint details or uses the wrong synthetic labels.
- [x] **Step 3: Update the share model/export layout** to use the normalized official rows, preserving the existing 1080 × 1350 dimensions and clearly indicating when the canvas must show fewer rows than the screen.
- [x] **Step 4: Run the full Vitest suite, lint, and production build**; record any external Supabase/Strava gates separately.
- [x] **Step 5: Verify live Supabase read-only acceptance queries** for official results, all checkpoint rows, and ready/included personal photos; run advisors and address only findings introduced by this change.
- [x] **Step 6: Commit** with `git add lib tests docs && git commit -m "test: align wrapped export with official stats"`.

## Handoff

Implementation should begin only after this plan is reviewed. Recommended execution method: native execution in this worktree, because the tasks share one payload/view-model contract and need sequential UI/export verification. Use `superpowers:executing-plans` task-by-task and keep each task's test cycle green before moving to the next.
