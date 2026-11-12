# Integrate All Branches into Dev Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one reviewable branch based on `origin/dev` that contains every unique surviving local and remote branch change, then measure the integrated product against the authoritative PRD.

**Architecture:** Use Git ancestry to avoid redundant merges. Merge `origin/integration` first because it subsumes `origin/strava-integration`, then merge `origin/main` and `origin/dev-harry`; branches already ancestral to `origin/dev` require no merge. Preserve complete histories and resolve conflicts in favor of working behavior, without hiding PRD disagreements.

**Tech Stack:** Git, Next.js 16, React 19, TypeScript, Vitest, ESLint

**Spec:** `PRODUCT.md`

## Global Constraints

- Data ownership must be enforced by verified Supabase sessions and server-owned mappings.
- Chip data remains the baseline; enrichment must be independently failure-tolerant.
- Do not infer hydration, invent missing timing, or describe demo metrics as live.
- The approved November 2 direction requires complete opt-in Strava behavior; real-provider acceptance remains deferred until credentials are supplied.
- Synthetic fixtures and stock photo mappings must be labeled as demonstrations.
- Recap exports must be exactly 1080 x 1350 PNG.
- Public personal recap links are prohibited.

## Review Focus

- Unauthorized runner access must remain blocked after the integration merge.
- Missing or failed Strava enrichment must not prevent chip-result recap recovery.
- DNS, DNF, missing-result, and finish states must remain distinct.
- Synthetic/demo content must not be presented as live personal data.
- Export dimensions and private recap behavior must remain unchanged.

---

### Task 1: Merge Unique Product Branches

**Files:**
- Modify: Git history and any conflict-affected application files
- Test: `tests/**/*.test.ts`, `tests/**/*.test.mts`

**Interfaces:**
- Consumes: `origin/dev`, `origin/integration`, `origin/main`, `origin/dev-harry`
- Produces: `codex/integrate-all-into-dev` containing all non-redundant branch histories

- [ ] **Step 1: Merge `origin/integration` with a merge commit**
- [ ] **Step 2: Resolve conflicts without weakening authorization or recap fallback behavior**
- [ ] **Step 3: Run `npm test` and require all non-environment tests to pass**
- [ ] **Step 4: Merge `origin/main` and preserve its documentation and image updates**
- [ ] **Step 5: Merge `origin/dev-harry`, resolving superseded documentation conflicts against the newer integrated tree**
- [ ] **Step 6: Confirm every branch tip is an ancestor of the integrated branch**

### Task 2: Verify the Integrated Application

**Files:**
- Test: `tests/**/*.test.ts`, `tests/native/*.test.mts`
- Verify: application source, configuration, and generated build output

**Interfaces:**
- Consumes: integrated branch from Task 1
- Produces: test, lint, and production-build evidence

- [ ] **Step 1: Run `npm test`**
- [ ] **Step 2: Run `npm run test:native`**
- [ ] **Step 3: Run `npm run lint`**
- [ ] **Step 4: Run `npm run build`**
- [ ] **Step 5: Record any environment-only verification that cannot run locally**

### Task 3: Compare the Result with the PRD

**Files:**
- Read: `PRODUCT.md`
- Read: `docs/SRS_v4.md`
- Read: `docs/requirements-register.md`
- Inspect: integrated application and tests

**Interfaces:**
- Consumes: verified integrated branch and authoritative requirements
- Produces: requirement-by-requirement status with evidence and remediation priorities

- [ ] **Step 1: Map each `PRODUCT.md` success criterion and constraint to implementation and tests**
- [ ] **Step 2: Classify each item as met, partial, unmet, deferred, or contradicted**
- [ ] **Step 3: Reconcile the superseded October 20 disconnected-only decision with the approved November 2 full opt-in Strava direction**
- [ ] **Step 4: Report the integrated commit, verification evidence, and ordered PRD gaps**
