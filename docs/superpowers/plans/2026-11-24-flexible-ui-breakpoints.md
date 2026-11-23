# Flexible UI Breakpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the existing responsive CSS so every current screen remains usable and visually balanced from 320 px through 1920 px without changing product behavior.

**Architecture:** Keep the current components and Figma-derived visual language. Add a small CSS contract test, then repair the existing page-specific breakpoint blocks in `app/globals.css`; change component markup only when a stable responsive hook is missing.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS, Vitest, Playwright-backed in-app browser acceptance.

**Spec:** `docs/superpowers/specs/2026-11-24-flexible-ui-breakpoints-design.md`

## Global Constraints

- Preserve the current red/cream/lime identity, routes, APIs, copy, and workflow behavior.
- Support representative viewport widths of 320, 390, 768, 1024, 1440, and 1920 px.
- Prevent horizontal document overflow; tables may scroll only inside their bounded container.
- Preserve keyboard focus, touch usability, zoom, and reduced-motion behavior.
- Do not add a CSS framework or component library.

## Review Focus

- A 320 px viewport with long runner names/BIBs must wrap without document overflow — covered in Task 2 CSS contract and browser checks.
- Tablet widths between the existing 700/800/900 px rules must not produce conflicting auth or story layouts — covered in Tasks 2 and 3.
- Story controls and progress must remain reachable in portrait and short landscape viewports — covered in Task 3.
- Organizer tables, field grids, and claim rows must contain their own overflow — covered in Task 4.
- 200% zoom and reduced motion must preserve navigation and focus visibility — covered in Tasks 1 and 5.

---

### Task 1: Responsive Contract and Baseline Evidence

**Files:**
- Create: `tests/responsiveLayout.test.ts`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: static CSS contract assertions for viewport containment, focus visibility, reduced motion, and bounded table overflow.
- Consumes: existing semantic classes in `app/globals.css`.

- [ ] **Step 1: Write failing CSS contract tests**

Add tests that read `app/globals.css` and assert rules exist for `box-sizing: border-box`, global media containment, `:focus-visible`, `prefers-reduced-motion`, `.table-scroll { overflow-x: auto }`, and the 320–390 px compact breakpoint.

- [ ] **Step 2: Run the contract test and verify failure**

Run: `npm test -- tests/responsiveLayout.test.ts`
Expected: FAIL on the missing compact-width and containment contracts.

- [ ] **Step 3: Add the minimal global responsive foundation**

Normalize replaced elements and form controls to `max-width: 100%`, add safe overflow containment without hiding focus, and define a compact `@media (max-width: 390px)` layer. Preserve the existing reduced-motion rule.

- [ ] **Step 4: Run the contract test and typecheck**

Run: `npm test -- tests/responsiveLayout.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/responsiveLayout.test.ts app/globals.css
git commit -m "test: define responsive layout contract"
```

### Task 2: Flexible Shell, Authentication, Dashboard, and Profile

**Files:**
- Modify: `app/globals.css`
- Modify only if a hook is missing: `app/components/AppHeader.tsx`
- Modify only if a hook is missing: `app/components/RacePassCard.tsx`
- Test: `tests/responsiveLayout.test.ts`
- Test: `tests/runnerIdentityShell.test.ts`
- Test: `tests/runnerWorkflow.test.ts`

**Interfaces:**
- Consumes: existing `.app-header`, `.auth-layout`, `.auth-masthead`, `.auth-panel-stage`, `.registration-grid`, `.race-pass-card`, and profile classes.
- Produces: stable one/two-column transitions and wrapping navigation/actions at 320, 390, 768, 1024, 1440, and 1920 px.

- [ ] **Step 1: Extend failing contract assertions**

Assert compact header wrapping, full-width phone actions, a tablet auth stack, a desktop auth split, one-column phone cards, and bounded long identity text.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/responsiveLayout.test.ts tests/runnerIdentityShell.test.ts tests/runnerWorkflow.test.ts`
Expected: FAIL on the new breakpoint rules.

- [ ] **Step 3: Repair shell and runner-page breakpoints**

Patch the current 700/800 px rules so header navigation, auth panels, profile form rows, race pass actions, and recovery disclosures wrap before content becomes cramped. Cap wide-screen content line length and card width without introducing empty fixed columns.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- tests/responsiveLayout.test.ts tests/runnerIdentityShell.test.ts tests/runnerWorkflow.test.ts tests/profile.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css app/components/AppHeader.tsx app/components/RacePassCard.tsx tests/responsiveLayout.test.ts
git commit -m "fix: make runner shell responsive"
```

### Task 3: Flexible Seven-Scene Wrapped and Strava Journey

**Files:**
- Modify: `app/globals.css`
- Modify only if responsive hooks are missing: `app/components/StoryProgress.tsx`
- Modify only if responsive hooks are missing: `app/components/StoryControls.tsx`
- Test: `tests/responsiveLayout.test.ts`
- Test: `tests/recapStory.test.ts`
- Test: `tests/runnerStravaSetup.test.ts`

**Interfaces:**
- Consumes: existing story scene, progress, controls, decoration, metric, candidate, photo, and share-preview classes.
- Produces: contained story geometry with safe-area-aware controls and responsive Strava cards.

- [ ] **Step 1: Add failing story and Strava CSS assertions**

Assert seven equal progress segments, scroll-safe tabs at compact width, safe-area bottom controls, short-landscape handling, responsive stat grids, bounded decorations, and stacked candidate actions.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/responsiveLayout.test.ts tests/recapStory.test.ts tests/runnerStravaSetup.test.ts`
Expected: FAIL on the missing compact and landscape rules.

- [ ] **Step 3: Repair story and journey breakpoints**

Consolidate conflicting story declarations only where required; scale type/art with `clamp`, keep progress/control safe areas visible, collapse statistics and candidate controls at narrow widths, and constrain the desktop stage at wide widths.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- tests/responsiveLayout.test.ts tests/recapStory.test.ts tests/recapStravaFirst.test.ts tests/runnerStravaSetup.test.ts tests/stravaViewModel.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css app/components/StoryProgress.tsx app/components/StoryControls.tsx tests/responsiveLayout.test.ts
git commit -m "fix: make wrapped journey responsive"
```

### Task 4: Flexible Organizer Workspace

**Files:**
- Modify: `app/globals.css`
- Modify only if responsive hooks are missing: `app/components/OrganizerPanel.tsx`
- Modify only if responsive hooks are missing: `app/components/OrganizerRunnerAccess.tsx`
- Modify only if responsive hooks are missing: `app/components/OrganizerStravaRaceConfig.tsx`
- Test: `tests/responsiveLayout.test.ts`
- Test: `tests/organizerEditor.test.ts`
- Test: `tests/organizerRunnerAccess.test.ts`

**Interfaces:**
- Consumes: existing organizer toolbar, editor, form-grid, table-scroll, access-list, and configuration classes.
- Produces: independent collapsing grids and bounded table scrolling at phone/tablet widths.

- [ ] **Step 1: Add failing organizer layout assertions**

Assert one-column phone toolbars/forms, wrapped claim rows, two-column tablet fields, auto-fit desktop fields, and table-local horizontal scrolling.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/responsiveLayout.test.ts tests/organizerEditor.test.ts tests/organizerRunnerAccess.test.ts`
Expected: FAIL on the missing organizer breakpoint rules.

- [ ] **Step 3: Repair organizer breakpoints**

Patch the existing organizer rules so actions wrap, editor/config fields collapse deliberately, claim codes wrap, and tables remain keyboard-scrollable within `.table-scroll`.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- tests/responsiveLayout.test.ts tests/organizer.test.ts tests/organizerEditor.test.ts tests/organizerRunnerAccess.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css app/components/OrganizerPanel.tsx app/components/OrganizerRunnerAccess.tsx app/components/OrganizerStravaRaceConfig.tsx tests/responsiveLayout.test.ts
git commit -m "fix: make organizer workspace responsive"
```

### Task 5: Cross-Viewport Acceptance and Final Verification

**Files:**
- Modify if evidence changes: `docs/qa/acceptance-matrix.md`
- Modify only when browser evidence requires a correction: `app/globals.css`

**Interfaces:**
- Consumes: all responsive behavior from Tasks 1–4.
- Produces: verified responsive evidence across the target viewport matrix.

- [ ] **Step 1: Run automated verification**

Run: `npm test && npm run test:native && npm run lint && npx tsc --noEmit && npm run build`
Expected: PASS, with environment-gated skips reported explicitly.

- [ ] **Step 2: Inspect the target viewport matrix**

Using the authenticated local app, inspect login, registration, dashboard, profile, Strava setup, all seven Wrapped scenes, and organizer at 320, 390, 768, 1024, 1440, and 1920 px. At each width record `scrollWidth <= clientWidth` for the document and verify table-local scrolling separately.

- [ ] **Step 3: Check interaction accessibility**

Keyboard through header links, disclosures, forms, story progress/controls, candidate cards, and organizer tools; inspect focus visibility, 200% zoom, short landscape, and reduced motion.

- [ ] **Step 4: Fix only evidenced defects and rerun their focused tests**

Any browser-discovered correction must include a matching assertion in `tests/responsiveLayout.test.ts` before the CSS change.

- [ ] **Step 5: Record acceptance evidence and commit**

```bash
git add docs/qa/acceptance-matrix.md app/globals.css tests/responsiveLayout.test.ts
git commit -m "docs: record flexible UI acceptance"
```

- [ ] **Step 6: Confirm a clean branch**

Run: `git status --short && git log --oneline origin/dev..dev`
Expected: clean worktree and the planned responsive commits listed.
