# Marathon Wrapped: core-first design proposal

Date: October 20, 2026 (Asia/Jakarta).

Status: **Implementation authorized October 20, 2026.** The user approved creating the free project and continuing the goal, including backend changes under the documentation constraints. These implementation policies do not establish historical team approval or replace SRS V3.

## Intended outcome

Deliver the course prototype described by SRS V3: a runner opens a recap of their own Soekarno Run 2027 result, optionally adds Strava metrics, views manually matched race photos, and saves a card image. Organizers can view event results and manage demo runners. Build and verify the data and application core before adapting the Figma cards with Impeccable.

Retain one event, 5K/10K, seeded timing, simulated FotoYu, real optional Strava, and free-tier infrastructure. Do not add registration commerce, live timing hardware, facial recognition, or payment processing.

## Evidence and baseline

Remote `main`, local `origin/main`, and this worktree HEAD were all `f957aec6a6444cdb8489c5c7383e052b4c47a920` when checked on October 20. The worktree had no changes before this planning work and is detached. Recheck upstream before execution; preserve subsequent upstream changes.

Sources: [SRS V3](../../SRS_v3.md), [validation record](../../SRS_VALIDATION.md), [contract](../../data-contract.md), [statistics guide](../../wrapped-statistics.md), [UI notes](../../UI_IMPLEMENTATION.md), [roadmap](../../../ROADMAP.md), and the current migration, controller, API route, tests, and card source.

| Existing capability | Finding and consequence |
| --- | --- |
| Pure `/lib` statistics and Vitest fixtures | Preserve names, formulas and insight order; add boundary validation rather than rewriting this layer. Tests were read, not executed during planning. |
| `getRunnerChipInput` | Loads `runner_wrapped` plus splits but trusts response types and has no ownership check. Separate authentication, authorization, repository validation and composition. |
| `GET /api/runners/[runnerId]/wrapped` | Returns chip input, not `buildWrappedStats` output; lacks identifier validation and access control. |
| Initial Supabase migration | Enables table RLS, but has no application access model. The view lacks `security_invoker`; treat view access explicitly. Stored rank fields are passed through. |
| `db/seed.sql` | Broken `new_result` CTE spelling and repeated `new_split` names; one sample 5K runner, incomplete demo coverage, placeholder photo URL. Replace with a repeatable Soekarno seed. |
| `app/page.tsx` | Hardcoded runner, local formulas, static hydration claims, placeholder photos and demo-only copy link. No real runner retrieval. |
| Environment setup | Server requires `SUPABASE_URL`; `.env.example` only documents `NEXT_PUBLIC_SUPABASE_URL`. Resolve this in the core configuration task. |

## Infrastructure and design references

The user changed the selected organization to **buns project**, ID `qltvdxsrkupbgplgmhxg`, and explicitly accepted the $0/month quote. New project **marathon-wrapped**, ref `anbnuegocddoowagqmxw`, was created in Singapore (`ap-southeast-1`) and verified `ACTIVE_HEALTHY`. Earlier kahur2005 quota and new-connection transport failures were resolved. No existing project was paused, deleted, upgraded or reused. Runtime credentials are stored only in ignored local environment files.

Use a local Supabase database for development if its CLI/container prerequisites are available. A local reset is restricted to a dedicated development database. Never use `db/reset.sql` on an existing cloud project to get around this blocker.

Figma reference supplied by the user: [Copy design from Figma](https://www.figma.com/make/sLIMrcvenrQQAocKyvfaAK/Copy-design-from-Figma), Make key `sLIMrcvenrQQAocKyvfaAK`. `get_design_context` returned source/asset resource references, including `src/App.tsx` and `src/index.css`; resource reads failed both through the unavailable Figma server name and through the connected codex_apps server's Unknown resource response. The Make's browser preview is now readable: its opening card has a red photo background, lime/cream headline, progress bars and next control. **Source contents and exact assets remain unavailable; source export in the browser requires sign-in.** Acquire readable source/assets before claiming faithful UI implementation. Make is not supported by the Design-only screenshot tool.

Impeccable context reports an incumbent visual implementation, no PRODUCT.md/DESIGN.md, and no automatic design hook. Preserve the established visual identity while documenting it; missing design documentation does not imply a redesign.

## Approach choices

**Recommended: extend the existing Next.js core in ordered increments.** Keep pure statistics, add a server-only repository/composer, verify database and access boundaries, then add optional integrations and UI. This uses existing work and gives each phase a working acceptance gate.

An alternative is to wire the cards straight to the current endpoint. It is quicker to demonstrate but leaves seed, authorization, missing-result and rank correctness unresolved. A full rewrite would discard useful tested logic and is unnecessary for this course scope.

## Proposed decisions for OD-01 through OD-08

These are the selected implementation policies, not historical team decisions. Source SRS stakeholder validation remains distinct from implementation authorization.

| Decision | Proposed rule |
| --- | --- |
| OD-01 result lifecycle | Recognize `finisher`, `dnf`, `dns`, `unavailable`, and `invalid`. A runner without a result is unavailable; a started non-finisher is DNF; DNS comes from `start_status`. Non-finishers have null finish time, pace, ranks and percentile. Invalid records raise a controlled data error rather than being relabeled DNF. |
| OD-02 ranks | Competition ranking (`1,1,3`) among valid finishers. Category rank partitions by category; `overall_rank` partitions by event AND distance, across genders. Never compare raw 5K and 10K elapsed times. The UI must label the overall field “Overall in 5K/10K”. This changes any inherited cross-distance seed ranks and must be recorded in the contract. |
| OD-03 splits | Preserve current contract: tied fastest km uses earliest marker; complete 5K compares km 1–2 against 4–5; 10K compares 1–5 against 6–10; even tolerance is half-size seconds. Incomplete splits retain fastest km but no half comparison. Reject duplicate/out-of-range/nonpositive splits at ingestion. |
| OD-04 identity | Supabase Auth with server-verified user identity, plus server-managed `runner_access(user_id, runner_id)` and `organizer_access(user_id, event_id)` mappings. Seeded demo accounts use local credentials; credentials are never committed. BIB is lookup data, never authorization. No public arbitrary-runner API. |
| OD-05 Strava | Runner explicitly connects, then selects an activity matching event date and compatible distance; no silent “latest activity” choice. Baseline survives denial, timeout, partial metrics or rate limits. Disconnect immediately hides local metrics, removes local tokens and attempts remote deauthorization; a remote failure is shown as pending retry, never a false success. Use documented units. |
| OD-06 image export | PNG at 1080 × 1350 of the selected runner's share composition. Wait for fonts and usable images. Failed photos use a designed placeholder; export must remain retryable and leave stored results untouched. Sharing an image is supported; public personal recap links are out of scope until a separate sharing access model is approved. |
| OD-07 organizer saves | One transaction creates/updates runner, result, splits, optional metrics and photo mappings. Immutable assigned BIBs remain enforced. Replacement creates a distinct runner; it does not transfer an existing BIB. Rejection rolls back the entire save. |
| OD-08 acceptance environment | Record exact browser versions and machine/network at execution. Proposed viewports: 390 × 844 and 1440 × 900, Chrome and Edge desktop plus an actual available mobile browser. On a production build and fixed dataset, 19 of 20 consecutive loads reach usable chip recap within 3 seconds. Record cold/warm conditions and measure integrations separately. |

## Architecture and boundaries

`verified session → access guard → validated repository → buildWrappedStats → optional enrichment merge → WrappedPayload → cards/export`

Keep core queries behind Next.js server modules. The privileged Supabase client must never enter client bundles. Browser roles cannot directly select application tables or the Wrapped view in this proposal. RLS and explicit revokes apply to application tables and the view; the server uses its service credential only after validating user and event/runner access. Supabase Auth continues to use a publishable key. Session identity must come from server verification, never a request body or user-editable metadata.

`runner_access` and `organizer_access` are server-managed tables with RLS enabled and no browser grants. Implement a single access-guard module used by every read/write route. An organizer may access only mapped events. Return 401 for absent sessions, 400 for malformed identifiers and 404 for nonexistent or forbidden runner IDs to avoid existence disclosure. Unknown organizer permissions yield 403. Private responses use `Cache-Control: private, no-store`.

Create a follow-up migration; do not edit the historical initial migration. Use an invoker view for the current projection with restricted grants, derive ranks from valid results rather than manually maintained seed values, and retrieve the runner separately so the view's inner join cannot hide the difference between missing runner and missing result. Cross-check stored timing against start/finish and distance when writing and reading.

Keep `RunnerChipInput` and `WrappedStats` field names. The new discriminated response is:

```ts
type WrappedPayload =
  | { status: "finisher" | "dnf" | "dns"; stats: WrappedStats;
      strava: { state: "disconnected" | "connected" | "unavailable" | "demo";
        metrics: StravaMetrics | null };
      photos: Photo[]; warnings: string[] }
  | { status: "unavailable"; runner: { runner_id: string; name: string;
      bib_number: string | null }; reason: "missing_result" };
```

`StravaMetrics` exposes only the five documented nullable metrics; `Photo` contains ID, URL, photographer, captured km/time. Never include registration contacts, ID documents, birth dates or OAuth credentials. Seeded Strava samples are visibly `demo`, never a real connection.

## Delivery boundaries and acceptance

1. **Core:** repeatable schema/seed, verified sessions, access controls, validated chip retrieval, computed API, and complete tests against a dedicated database. Include minimal login/API smoke pages only as needed; visual UI work waits.
2. **Enrichment and management core:** optional photos, real Strava lifecycle, protected organizer read/save APIs and database transactions. This phase can fail independently without losing the chip baseline.
3. **UI:** use the actual Make design and existing palette (`#BA3143`, `#FAF6EB`, `#D8F24B`, text `#291B1D`), adapt to Next.js, and replace hardcoded values with the verified payload. Impeccable guides product context, states, responsive behavior, accessibility, and a bounded desktop/mobile visual pass. Hydration has no data source and stays out of the personalized recap pending an approved requirement and dataset.
4. **Release acceptance:** inspect real exported PNGs for two runners; verify DNF/DNS/missing data, absent and broken photos, skipped/denied Strava, expiry/disconnect, unauthorized access and rejected organizer saves. Execute the SRS quality targets and populate requirement evidence.

Baseline response must not wait for a Strava network request. Read persisted optional data separately; an optional-source error returns a warning and baseline. One baseline request per route load, with stale responses canceled/ignored when switching runner. No duplicate ranking/split arithmetic in components.

## Review checklist and remaining decisions

- [x] Establish purpose, scope and current main baseline from project sources.
- [x] Compare existing architecture and identify concrete integration gaps.
- [x] Compare approaches and propose decisions for the eight SRS open items.
- [x] Identify selected Supabase organization and attempt the explicitly requested new project.
- [x] Record quota failure and preserve existing resources.
- [x] Record exact Figma reference and limits of connector inspection.
- [x] Self-review consistency, scope, boundaries and decision status.
- [x] User authorized continuing implementation; execute inline with an independent core review.
- [x] User selected a new account/organization and approved $0 creation; new project healthy.
- [ ] Read/render the Make design before final UI task planning and implementation.

Companion documents: [core implementation plan](../plans/2026-10-20-core-foundation.md), [delivery roadmap](../plans/2026-10-20-delivery-roadmap.md), and [core verification record](../../qa/core-foundation.md). Implementation is in progress; full UI/integration acceptance is not established.
