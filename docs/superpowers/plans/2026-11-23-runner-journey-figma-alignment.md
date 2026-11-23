# Runner Journey Figma Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a coherent, responsive runner journey matching the approved Figma visual world, with official BIB results unlocking Wrapped and Strava enriching the recap when available.

**Architecture:** Normalize official and Strava payloads into one presentation model before rendering, then rebuild the runner surfaces from small branded components without changing the existing authentication, claim, Strava, or privacy boundaries. Implement the runner journey first; apply its tokens and primitives to the organizer shell only after runner verification passes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind/PostCSS plus repository CSS, Supabase, Vitest/jsdom, Canvas PNG export.

**Spec:** `docs/superpowers/specs/2026-11-23-runner-journey-figma-alignment-design.md`

## Global Constraints

- Race red `#a61729`, deep red `#7a051d`, cream `#fff6ec`, lime `#c8f02e`, and field `#fffaf4` remain the core palette through semantic CSS variables.
- Bricolage remains the product typeface for display, headings, statistics, labels, and controls.
- Official result data is authoritative for finish status, official elapsed time, event distance, and official splits.
- A verified official result unlocks the seven-slide Wrapped story and 1080 × 1350 PNG without ready Strava.
- Strava enrichment may add cadence, elevation, heart rate, photos, and compatible split context but cannot override official status.
- DNF, DNS, DQ, and unknown outcomes must not display finisher copy or fabricated completion statistics.
- Hydration claims and Copy Link remain excluded because production has no supporting contract.
- Preserve authenticated APIs, `runner_access`, `organizer_access`, same-origin checks, private cache headers, explicit claim submission, and claim-token URL scrubbing.
- Use local assets only; do not embed complete-screen screenshots or temporary Figma URLs.
- Validate approximately 390 px, 768 px, and 1280–1440 px widths, keyboard focus, and reduced motion.

## Review Focus

- Official result present while Strava is unavailable: story and export still work from official data; Task 1 and Task 6 tests pin this.
- Non-finisher outcomes with partial or contradictory timing: no finisher language, pace, or invented splits; Task 1 and Task 5 tests pin this.
- Expired authentication during claim, Strava polling, or recap load: redirect to login without exposing a token or leaving a dead end; Task 3 and Task 4 tests pin this.
- Optional photos/metrics missing or late: the active recap remains stable and does not reuse stale enrichment; Task 5 tests pin this.
- Long names, localized dates, narrow screens, keyboard use, and reduced motion: controls remain reachable and text does not clip; Task 2, Task 5, and Task 7 checks pin this.

---

### Task 1: Normalize Official and Strava Wrapped Data

**Files:**
- Create: `lib/recapViewModel.ts`
- Modify: `lib/wrappedPayload.ts`
- Modify: `lib/officialWrappedService.ts`
- Modify: `lib/runnerCatalog.ts`
- Modify: `app/api/runners/[runnerId]/wrapped/route.ts`
- Test: `tests/recapViewModel.test.ts`
- Test: `tests/officialWrappedService.test.ts`
- Test: `tests/api/wrapped.test.ts`
- Test: `tests/runnerWorkflow.test.ts`

**Interfaces:**
- Produces: `RunnerWrappedPayload = OfficialWrappedPayload | StravaFirstWrappedPayload`.
- Produces: `RecapViewModel` with `source`, `outcome`, `registration`, `performance`, `strava`, `photos`, and `exportable` fields.
- Produces: `buildRecapViewModel(payload: RunnerWrappedPayload): RecapViewModel`.
- Extends: `OfficialWrappedPayload` with top-level `registration: WrappedRegistration` so official-only rendering never depends on successful enrichment.
- Extends: `CatalogRunner` with `wrappedAvailable: boolean`; an official result sets `primaryAction: "view"` while Strava remains optional enrichment.

- [ ] **Step 1: Write failing presentation-model tests**

Add table-driven tests asserting that official finished, DNF, DNS, DQ, and unknown payloads normalize correctly; official-only payloads are exportable; Strava-ready payloads still normalize; and official status/time/splits win over conflicting Strava fields.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npm test -- tests/recapViewModel.test.ts tests/officialWrappedService.test.ts tests/api/wrapped.test.ts tests/runnerWorkflow.test.ts`

Expected: FAIL because the shared payload/model and official catalog availability do not exist.

- [ ] **Step 3: Add the shared payload and view-model interfaces**

Implement the exact exported types and `buildRecapViewModel` signature above. For non-finishers, set `performance` to a result-aware structure with nullable elapsed/pace fields rather than deriving missing values.

- [ ] **Step 4: Make the official service return registration independently of Strava**

Load the runner/event/category identity within `getOfficialWrappedForUser` and populate `OfficialWrappedPayload.registration`; keep optional Strava failures non-fatal.

- [ ] **Step 5: Make the catalog prefer official Wrapped availability**

Batch-load official result runner IDs alongside existing workflow reads and set `wrappedAvailable` plus `primaryAction: "view"` without removing the underlying Strava state used inside the recap.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- tests/recapViewModel.test.ts tests/officialWrappedService.test.ts tests/api/wrapped.test.ts tests/runnerWorkflow.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/recapViewModel.ts lib/wrappedPayload.ts lib/officialWrappedService.ts lib/runnerCatalog.ts app/api/runners/[runnerId]/wrapped/route.ts tests/recapViewModel.test.ts tests/officialWrappedService.test.ts tests/api/wrapped.test.ts tests/runnerWorkflow.test.ts
git commit -m "fix: unify official and Strava wrapped data"
```

### Task 2: Build the Shared Auth and Runner Identity Shell

**Files:**
- Create: `app/components/AuthMasthead.tsx`
- Create: `app/components/AuthPanel.tsx`
- Create: `app/components/RunnerFeedback.tsx`
- Modify: `app/login/page.tsx`
- Modify: `app/register/page.tsx`
- Modify: `app/components/RunnerProfile.tsx`
- Modify: `app/globals.css`
- Test: `tests/bibRegistrationPage.test.ts`
- Test: `tests/profile.test.ts`
- Test: `tests/api/register.test.ts`
- Test: `tests/api/googleCallback.test.ts`

**Interfaces:**
- Produces: `AuthMasthead({ compact?: boolean })` for the Figma race-image/event treatment.
- Produces: `AuthPanel({ title, children, footer? })` for semantic form/confirmation framing.
- Produces: `RunnerFeedback({ kind: "status" | "error" | "empty", title, children })` for accessible runner-facing feedback.
- Consumes: existing email/password, BIB reservation/linking, profile, and Google OAuth handlers unchanged.

- [ ] **Step 1: Add failing auth/profile UI tests**

Assert neutral signup confirmation does not disclose duplicate status, login retains working Google OAuth, signed-in BIB linking retains review/accept behavior, profile preserves name/BIB operations, and feedback uses `role="status"` or `role="alert"` appropriately.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/bibRegistrationPage.test.ts tests/profile.test.ts tests/api/register.test.ts tests/api/googleCallback.test.ts`

Expected: FAIL on the new shared-shell and feedback assertions.

- [ ] **Step 3: Create the three shared components**

Keep the masthead decorative image semantics separate from form headings; keep `AuthPanel` layout-only; make `RunnerFeedback` the only shared status/error visual.

- [ ] **Step 4: Refactor login, register, and profile to the shared shell**

Preserve API calls, BIB acceptance, OAuth callback, loading guards, and form names. Keep Google on login; registration provides a clear login route.

- [ ] **Step 5: Replace auth/profile override blocks with one semantic CSS section**

Use existing CSS variables, mobile-first layout, a deliberate desktop split, visible focus, long-name wrapping, and `prefers-reduced-motion` handling.

- [ ] **Step 6: Run focused tests and static checks**

Run: `npm test -- tests/bibRegistrationPage.test.ts tests/profile.test.ts tests/api/register.test.ts tests/api/googleCallback.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/components/AuthMasthead.tsx app/components/AuthPanel.tsx app/components/RunnerFeedback.tsx app/login/page.tsx app/register/page.tsx app/components/RunnerProfile.tsx app/globals.css tests/bibRegistrationPage.test.ts tests/profile.test.ts
git commit -m "feat: align runner authentication with Figma"
```

### Task 3: Turn the Runner Home into a Race-Day Menu

**Files:**
- Create: `app/components/RacePassCard.tsx`
- Modify: `app/components/RunnerSelection.tsx`
- Modify: `app/components/RunnerWorkflowCard.tsx`
- Modify: `app/components/RunnerClaimForm.tsx`
- Modify: `app/components/AppHeader.tsx`
- Modify: `app/globals.css`
- Test: `tests/runnerWorkflow.test.ts`
- Test: `tests/claimHandoff.test.ts`
- Test: `tests/api/session.test.ts`

**Interfaces:**
- Produces: `RacePassCard({ runner }: { runner: CatalogRunner })` with event, category, BIB, name, state, one primary action, and optional enrichment link.
- Consumes: `CatalogRunner.wrappedAvailable` from Task 1.
- Preserves: `captureClaimToken`, `claimTokenSnapshot`, and explicit claim submission.

- [ ] **Step 1: Add failing menu and claim tests**

Assert official-ready runners see Wrapped as the primary action, zero-race accounts see the claim section open, a valid mailed token opens/prefills but never auto-submits, organizer access stays secondary, and expired sessions redirect without leaking the token.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/runnerWorkflow.test.ts tests/claimHandoff.test.ts tests/api/session.test.ts`

Expected: FAIL on official availability and disclosure behavior.

- [ ] **Step 3: Create and adopt `RacePassCard`**

Move runner-card presentation out of `RunnerWorkflowCard`; retain action routing and label vocabulary. Use semantic headings and links rather than clickable container cards.

- [ ] **Step 4: Recompose the dashboard**

Lead with the next race action, place claim/BIB recovery in a secondary disclosure, and keep profile/logout/organizer destinations in the shell.

- [ ] **Step 5: Add menu CSS and responsive grid**

Use a one-column mobile pass stack and restrained two-column desktop grid; ensure long names/BIBs do not clip.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npm test -- tests/runnerWorkflow.test.ts tests/claimHandoff.test.ts tests/api/session.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/components/RacePassCard.tsx app/components/RunnerSelection.tsx app/components/RunnerWorkflowCard.tsx app/components/RunnerClaimForm.tsx app/components/AppHeader.tsx app/globals.css tests/runnerWorkflow.test.ts tests/claimHandoff.test.ts
git commit -m "feat: build runner race-day menu"
```

### Task 4: Design Every Strava Journey State

**Files:**
- Create: `app/components/RunnerJourneyState.tsx`
- Create: `app/components/ActivityCandidateCard.tsx`
- Modify: `app/components/RunnerStravaSetup.tsx`
- Modify: `app/components/StravaCard.tsx`
- Modify: `lib/strava/viewModel.ts`
- Modify: `app/globals.css`
- Test: `tests/runnerStravaSetup.test.ts`
- Test: `tests/stravaViewModel.test.ts`

**Interfaces:**
- Produces: `RunnerJourneyState({ state, title, body, action, tone })` for branded setup/loading/recovery states.
- Produces: `ActivityCandidateCard({ candidate, selected, onSelect })` using date/time, distance, sport type, GPS availability, and match reason only.
- Consumes: the existing runner-scoped action routes and `runStravaAction` interface unchanged.

- [ ] **Step 1: Add failing state-coverage tests**

Cover setup, attachable, authorizing, importing, confirmation, no match, building, failed, disconnecting, reauthentication, reauthorize-to-disconnect, ready, denied access, and expired authentication. Assert no candidate duration or fake location appears.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/runnerStravaSetup.test.ts tests/stravaViewModel.test.ts`

Expected: FAIL on the expanded UI state and candidate presentation assertions.

- [ ] **Step 3: Create the state and candidate components**

Keep status copy in `lib/strava/viewModel.ts`; keep components presentational and make candidate selection keyboard-operable.

- [ ] **Step 4: Recompose setup and controls**

Preserve polling, callback-code scrubbing, attach/detach distinction, account disconnect, confirmation requests, and cancellation behavior.

- [ ] **Step 5: Add route-inspired visual treatment**

Use the shared palette and local SVG decorations; status content stays within the safe readable area at all breakpoints.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npm test -- tests/runnerStravaSetup.test.ts tests/stravaViewModel.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/components/RunnerJourneyState.tsx app/components/ActivityCandidateCard.tsx app/components/RunnerStravaSetup.tsx app/components/StravaCard.tsx lib/strava/viewModel.ts app/globals.css tests/runnerStravaSetup.test.ts tests/stravaViewModel.test.ts
git commit -m "feat: design the complete Strava journey"
```

### Task 5: Rebuild the Seven-Slide Story on the Shared Model

**Files:**
- Create: `app/components/StoryProgress.tsx`
- Create: `app/components/StoryControls.tsx`
- Modify: `app/components/RecapStory.tsx`
- Modify: `app/components/StravaSplitChart.tsx`
- Modify: `app/globals.css`
- Test: `tests/recapStory.test.ts`
- Test: `tests/recapStravaFirst.test.ts`
- Test: `tests/recapDecorations.test.ts`

**Interfaces:**
- Consumes: `RunnerWrappedPayload`, `RecapViewModel`, and `buildRecapViewModel` from Task 1.
- Produces: `StoryProgress({ current, count, onSelect })` and `StoryControls({ current, count, onPrevious, onNext })`.
- Preserves: seven-slide order, keyboard/swipe navigation, local decorations, optional photos, and active-data invalidation.

- [ ] **Step 1: Add failing story tests**

Assert official-only finished recaps render seven slides; DNF/DNS/DQ avoid finisher and pace claims; missing photos/metrics render directed empty states; long runner names remain text rather than truncated attributes; stale enrichment cannot replace a newer payload.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/recapStory.test.ts tests/recapStravaFirst.test.ts tests/recapDecorations.test.ts`

Expected: FAIL because `RecapStory` currently accepts only Strava-first payloads.

- [ ] **Step 3: Extract story navigation components**

Move progress and previous/next UI without changing the existing key/swipe state transitions.

- [ ] **Step 4: Render all scenes from `RecapViewModel`**

Use official result performance for distance/time/splits and outcome copy; place Strava metrics only in optional context; use measured race context instead of hydration claims.

- [ ] **Step 5: Consolidate story CSS**

Replace duplicate story override sections with one mobile-first section matching Figma scenes, controlled desktop stage sizing, safe-area controls, visible focus, and reduced motion.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npm test -- tests/recapStory.test.ts tests/recapStravaFirst.test.ts tests/recapDecorations.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/components/StoryProgress.tsx app/components/StoryControls.tsx app/components/RecapStory.tsx app/components/StravaSplitChart.tsx app/globals.css tests/recapStory.test.ts tests/recapStravaFirst.test.ts tests/recapDecorations.test.ts
git commit -m "feat: rebuild dynamic wrapped story"
```

### Task 6: Make PNG Export Support Official and Enriched Recaps

**Files:**
- Modify: `lib/shareModel.ts`
- Modify: `lib/exportWrapped.ts`
- Modify: `app/components/SharePreview.tsx`
- Test: `tests/shareModel.test.ts`
- Test: `tests/exportWrapped.test.ts`

**Interfaces:**
- Consumes: `RunnerWrappedPayload` and `RecapViewModel` from Task 1.
- Produces: `shareModel(payload: RunnerWrappedPayload)` and `exportWrapped(payload: RunnerWrappedPayload, signal?: AbortSignal)`.
- Preserves: 1080 × 1350 canvas, PNG-only download, cancellation, stale-export invalidation, and local assets.

- [ ] **Step 1: Add failing export tests**

Assert official-only finished export uses official time/distance/splits; enriched export adds allowed context without provider identity or health/location leakage; non-finishers use outcome-aware copy; canvas/blob/cancellation failures remain safe.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/shareModel.test.ts tests/exportWrapped.test.ts`

Expected: FAIL because export accepts only ready Strava payloads.

- [ ] **Step 3: Update share and export interfaces**

Drive text and numbers from the normalized model; keep canvas drawing independent of DOM screenshots.

- [ ] **Step 4: Align `SharePreview` with the exported geometry**

Render the same data hierarchy and local decorations as the PNG; do not add Copy Link.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm test -- tests/shareModel.test.ts tests/exportWrapped.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/shareModel.ts lib/exportWrapped.ts app/components/SharePreview.tsx tests/shareModel.test.ts tests/exportWrapped.test.ts
git commit -m "feat: export official wrapped recaps"
```

### Task 7: Apply the Runner System to the Organizer Shell

**Files:**
- Modify: `app/organizer/page.tsx`
- Modify: `app/components/OrganizerPanel.tsx`
- Modify: `app/components/OrganizerRunnerAccess.tsx`
- Modify: `app/components/OrganizerEnrichmentEditor.tsx`
- Modify: `app/components/OrganizerStravaRaceConfig.tsx`
- Modify: `app/globals.css`
- Test: `tests/organizer.test.ts`
- Test: `tests/organizerEditor.test.ts`
- Test: `tests/organizerRunnerAccess.test.ts`

**Interfaces:**
- Consumes: semantic palette, type, controls, panels, and `RunnerFeedback` from Task 2.
- Preserves: existing organizer APIs, server-side event authorization, results editing, claims, enrichment, and Strava configuration.

- [ ] **Step 1: Add failing organizer shell tests**

Assert the redesigned shell keeps event switching, edit forms, claim operations, error/status announcements, and keyboard-accessible field grouping.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/organizer.test.ts tests/organizerEditor.test.ts tests/organizerRunnerAccess.test.ts`

Expected: FAIL on the new shell structure and shared feedback assertions.

- [ ] **Step 3: Recompose the organizer shell and panels**

Apply runner-system typography and controls while retaining a dense, scannable admin layout. Do not introduce immersive story navigation into admin pages.

- [ ] **Step 4: Consolidate organizer CSS**

Use semantic variables, responsive field grids, visible focus, and bounded tables/lists without changing API behavior.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm test -- tests/organizer.test.ts tests/organizerEditor.test.ts tests/organizerRunnerAccess.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/organizer/page.tsx app/components/OrganizerPanel.tsx app/components/OrganizerRunnerAccess.tsx app/components/OrganizerEnrichmentEditor.tsx app/components/OrganizerStravaRaceConfig.tsx app/globals.css tests/organizer.test.ts tests/organizerEditor.test.ts tests/organizerRunnerAccess.test.ts
git commit -m "feat: align organizer shell with runner design"
```

### Task 8: Verify the Complete Journey and Push `dev`

**Files:**
- Modify if evidence requires: `docs/qa/acceptance-matrix.md`
- Modify if evidence requires: `README.md`
- Test: full repository verification and browser acceptance

**Interfaces:**
- Consumes: every prior task's committed runner/admin implementation.
- Produces: verified `dev` commits pushed to `origin/dev`.

- [ ] **Step 1: Install the locked dependency set if needed**

Run: `npm ci`

Expected: dependencies match `package-lock.json` without tracked file changes.

- [ ] **Step 2: Run automated verification**

Run: `npm test && npm run test:native && npm run lint && npx tsc --noEmit && npm run build`

Expected: all runnable tests and checks PASS; database/provider tests requiring external configuration are explicitly reported, not silently skipped as evidence.

- [ ] **Step 3: Run deterministic browser acceptance**

Start the app against authenticated fixtures or the dedicated non-production Supabase environment. Verify login, Google initiation, registration/BIB acceptance, confirmation, profile, mailed claim handoff, no-race menu, official-only finished/DNF/DNS stories, Strava setup/confirmation/recovery, seven slides, PNG export, and organizer access.

- [ ] **Step 4: Inspect responsive and accessibility states**

Capture the approved runner screens at approximately 390, 768, and 1440 px; keyboard through forms, disclosures, candidates, story progress, and controls; verify reduced-motion behavior and no horizontal overflow.

- [ ] **Step 5: Compare defined screens with Figma**

Compare login, registration, and Wrapped scenes against the inspected Figma Make preview and `D:/!! GITHUB CLEAN/Marathon-Wrapped/ui reference`. Fix only evidenced mismatches, then rerun the relevant focused tests.

- [ ] **Step 6: Update acceptance evidence and commit**

```bash
git add docs/qa/acceptance-matrix.md README.md
git commit -m "docs: record runner journey acceptance"
```

Skip the commit when no documentation changes are required.

- [ ] **Step 7: Confirm the worktree is clean and push**

Run: `git status --short && git log --oneline origin/dev..dev && git push origin dev`

Expected: clean worktree after committed docs, expected task commits listed before push, and `origin/dev` updated successfully.
