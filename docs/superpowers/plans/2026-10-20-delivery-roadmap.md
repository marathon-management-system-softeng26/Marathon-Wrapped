# Marathon Wrapped delivery roadmap

Date: October 20, 2026. **Execution authorized; core implemented, connected UI verification in progress.** See [core verification](../../qa/core-foundation.md) for actual checks and remaining acceptance gaps.

October 20 update: the user provided a local read-only Figma export in the primary checkout's `ui reference` directory. Its App.tsx and index.css were inspected; its source and portrait were not copied. The user has no Strava API app and chose a clear disconnected state. Real OAuth acceptance remains deferred. Follow the [connected UI plan](2026-10-20-connected-ui.md) and [actual acceptance map](../../qa/acceptance-matrix.md); later planning notes below describe the original roadmap, not remaining permission requests.

Read the [design proposal](../specs/2026-10-20-core-first-design.md) and [detailed core plan](2026-10-20-core-foundation.md) first. Later subsystems receive detailed task plans after the preceding interface and relevant SRS decisions are approved; this avoids writing speculative implementation code into a project-wide plan.

## Sequence and gates

| Phase | Deliverable | Gate before proceeding |
| --- | --- | --- |
| 1. Core foundation | Valid seed/schema, server identity/access checks, validated chip retrieval, computed runner API | Detailed core plan Task 7 passes against a dedicated database |
| 2A. Photo and metric composition | Persisted optional metrics and BIB-matched photo records; no dependency on provider uptime during recap read | Missing, broken, unrelated-BIB and failed optional sources preserve baseline |
| 2B. Real Strava lifecycle | OAuth connect/callback, activity selection, metric normalization, refresh and disconnect | Denial, missing scopes/fields, expiry, 429, timeout, mismatched activity and failed remote revocation covered |
| 2C. Organizer core | Event-scoped results API plus transactional hero-runner create/update | Runner denied, wrong-event organizer denied, rejected save fully rolls back, BIB immutability retained |
| 3. Impeccable UI | Auth/selection, real-data cards, gallery, Strava states, organizer screens and 1080 × 1350 PNG export | Browser journey and actual exported files inspected for at least two runners |
| 4. Acceptance/demo | SRS traceability, resilience, accessibility and measured performance evidence | Required requirements passed or explicitly recorded as unresolved; full prototype demo rehearsed |

Core means phases 1 and 2; visual UI begins after those interfaces work. Minimal unstyled integration screens may support core verification without replacing the existing card demo prematurely.

## Phase 2 planning contracts

**Photos and optional metrics.** Extend server repositories and `lib/merge.ts` using the `WrappedPayload` contract. Store manually mapped assets in Supabase Storage where available; use an explicitly scoped bucket policy and stable keys. Verify photo source files exist and can load before calling a hero complete. Return all matched photos; preserve attribution and distinguish no photos from an unavailable source. Never label seeded metrics as a live Strava connection.

**Strava.** Plan `app/api/strava/connect/route.ts`, `callback/route.ts`, `activities/route.ts`, `select/route.ts`, and `disconnect/route.ts` plus focused server modules under `lib/strava/`. Consult current official Strava OAuth, scopes, activity, rate-limit and deauthorization docs before fixing interfaces. Keep credentials in a private, non-Data-API schema; do not place provider tokens in `strava_metrics` or any runner payload. Bind single-use expiring OAuth state to verified user and runner, validate callback destination, handle missing fields without inventing zeros, and refresh server-side. Failed remote disconnect needs a bounded retry record without exposing retained retry credentials. A missing Strava app secret leaves connection unavailable with usable baseline; it does not justify simulating a successful OAuth flow.

**Organizer.** Plan `GET /api/organizer/events/:eventId/results` and `POST/PATCH /api/organizer/events/:eventId/runners`. Reuse `requireOrganizerAccess` before any privileged query. Implement atomic save through a transaction-capable database routine; restrict execution to the server role, validate all relationships and event scope inside the routine, and reject partial writes. UI correction messages must reflect the actual database rejection. Test wrong-category/event mutations, ineligible ages, duplicate/changed BIB, invalid timing, and partial save rollback.

## Phase 3: UI plan inputs and Impeccable workflow

Visual authority: [the supplied Figma Make](https://www.figma.com/make/sLIMrcvenrQQAocKyvfaAK/Copy-design-from-Figma) plus the existing branded implementation. The connector returned asset/source references, not a verified rendered screenshot. Read `src/App.tsx`, `src/index.css`, package dependencies and relevant assets through supported Figma resources, then inspect the rendered Make before finalizing the UI implementation plan. Do not invent source details or claim a screenshot comparison has passed.

Use the installed Impeccable skill. Its context loader already ran for `app/page.tsx` in this planning session; do not repeat within the same session. Capture PRODUCT.md with the user before new surfaces; document the existing visual world in DESIGN.md rather than interpreting missing documents as permission to redesign. Read the relevant new-work/operate guidance and craft-floor immediately before UI edits. No UI edits occurred in this planning pass.

Proposed file responsibilities: `app/login/page.tsx`, `app/runners/page.tsx`, `app/wrapped/[runnerId]/page.tsx`, `app/organizer/page.tsx`; focused components under `app/wrapped/components/` for shell, intro, distance, splits, Strava, gallery and share; `lib/exportWrapped.ts` for image export. The final UI plan must confirm actual Figma structure/assets before locking exact component composition.

The runner arrives after a race to understand their performance and save a memory. The recap is an Experience surface; selection and organizer management are Operate surfaces. Preserve the red/cream/lime palette, recognizable card sequence and primary performance numbers. Use `WrappedPayload` as the sole statistic source. Replace unsupported hydration claims with approved data-backed content; do not imply measured water intake. Keep fonts/assets local as directed by Figma tooling, avoiding temporary asset URLs in shipped code.

Define loading, retryable required-data error, result-unavailable, finisher, DNF, DNS, disconnected/denied/unavailable Strava, partial metrics, no photos, broken photos and export failure states. On runner changes, cancel/ignore stale requests. Keyboard/touch navigation must not capture input-field keystrokes; gallery focus returns to its opener. Include reduced-motion support, visible focus, sufficient contrast and long-name/large-time overflow cases. Gallery, connect and export must meet the SRS three-navigation-step limit from recorded starting screens.

Share output is the selected runner's rendered share composition at 1080 × 1350 PNG. Test fonts loaded, CORS-safe photo handling, broken image fallback, canvas/blob failure, retry and cleanup. Inspect two downloaded files and a DNF export, not just a download-success toast. Omit a personalized copy-link button until a separate authorized sharing model exists.

Build the complete UI, inspect desktop and mobile in one batched round, fix findings together and confirm with at most one more visual round. Run Impeccable's detector once on changed UI targets when finished. These bounded visual checks do not replace API/security tests.

## Requirement allocation

| Requirement area | Delivery owner |
| --- | --- |
| SR-F1–F7, result unavailable F23, data ownership F17; database integrity NF8–NF11 | Phase 1 |
| Optional Strava F8–F12, credential/privacy NF12–NF13 | Phase 2B with visible states in phase 3 |
| Photos F13–F15, combined view F16, graceful optional data NF3–NF7 | Phase 2A with rendering in phase 3 |
| Organizer F20–F22/F24, organizer separation NF14, hero dataset NF19 | Phases 1 and 2C with management interface in phase 3 |
| Export F18–F19, responsive usability NF15–NF17, presentation D clauses | Phase 3 |
| Performance NF1–NF2, free-tier NF18, final traceability and UR acceptance | All phases; measured and recorded in phase 4 |

Use the requirement register's lettered clauses when recording evidence. This allocation is not a passed-test claim.

## Pending user decisions

Review the proposed OD decisions in the design and the core plan, especially access/login and same-distance overall ranking. Recommended execution is inline; delegated implementation/review is available if selected.

Supabase provisioning is resolved: the user selected **buns project** and approved the $0/month quote. **marathon-wrapped**, ref `anbnuegocddoowagqmxw`, is healthy in Singapore. Neither kahur2005's Project nor barter was modified.
