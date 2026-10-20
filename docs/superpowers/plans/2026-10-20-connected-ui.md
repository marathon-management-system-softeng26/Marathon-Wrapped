# Connected recap UI implementation plan

> Execute inline with superpowers:executing-plans. Continue the approved core-first roadmap.

Goal: replace the hardcoded demo with authenticated real-data cards, selection, organizer management and accurate PNG export. Preserve the supplied Figma visual world; do not commit its reference source.

- [x] Auth and selection: add same-origin password sign-in/sign-out handlers; authenticated catalog endpoint unions explicit runner mappings with organizer event scope. Test invalid origin, unauthenticated catalog and role isolation. Use client requests so refresh cookies are persisted by handlers.
- [x] Story: replace app/page.tsx with selection; add login, runner recap route, loading/retry/empty states and focused client components. Fetch only WrappedPayload. Six cards: intro, distance/status, splits, optional Strava, photos, share. Hide finish/rank claims for nonfinishers. Direct tabs keep photos/export within three actions. Render stock and demo labels.
- [x] Export: pure share model tests cover finisher, DNF, DNS and unavailable; browser canvas uses that model, local fonts and no cross-origin photo. Render one matching DOM preview. Blob failures surface retryable errors; object URLs released after download. Verify PNG dimensions and contents for two runners and DNF.
- [x] Organizer: event-scoped results table, inline create/edit form with identity, eligibility, category, raw timing and per-km splits. Retrieve draft through a guarded endpoint; save only via existing atomic API. Refresh authoritative results after save. Preserve failed drafts.
- [x] Verify: unit/native/live suites, lint, typecheck, production build, desktop/mobile browser flows and exports, one detector run and independent review. Update evidence and roadmap honestly; real Strava OAuth remains deferred by user choice.

Files: lib/authHttp.ts; lib/runnerCatalog.ts; app/api/auth/{login,logout}/route.ts; app/api/session/route.ts; app/api/organizer/events/[eventId]/runners/[runnerId]/route.ts; app/components/{AppHeader,RunnerSelection,RecapStory,OrganizerPanel,SharePreview,Arrow}.tsx and useCatalog.ts; lib/shareModel.ts; lib/exportWrapped.ts; app/{page,login/page,organizer/page,wrapped/[runnerId]/page}.tsx; app/globals.css. Tests target security boundaries and data correctness, not CSS internals.

## Execution checkpoint

All listed implementation files exist. Auth/catalog/draft integration passed against the dedicated database. Core browser story, gallery focus return and Aina/Budi/DNF downloads were exercised. Final source adds authored SVG navigation and explicit export distance labels. 88 unit checks and 10 native checks pass; lint, TypeScript and production build pass. The 15 live checks passed after connectivity recovered and browser fixtures were removed.

Implementation and core browser acceptance are complete, including organizer create/update/rejection, optional enrichment, exports and twenty usable-page reloads under three seconds. Final-demo cross-browser certification and account-wide usage remain explicitly unverified. Real Strava OAuth is deferred by user choice. See [actual evidence](../../qa/connected-ui.md) and [SRS map](../../qa/acceptance-matrix.md).
