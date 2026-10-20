# Connected recap UI implementation plan

> Execute inline with superpowers:executing-plans. Continue the approved core-first roadmap.

Goal: replace the hardcoded demo with authenticated real-data cards, selection, organizer management and accurate PNG export. Preserve the supplied Figma visual world; do not commit its reference source.

- [ ] Auth and selection: add same-origin password sign-in/sign-out handlers; authenticated catalog endpoint unions explicit runner mappings with organizer event scope. Test invalid origin, unauthenticated catalog and role isolation. Use client requests so refresh cookies are persisted by handlers.
- [ ] Story: replace app/page.tsx with selection; add login, runner recap route, loading/retry/empty states and focused client components. Fetch only WrappedPayload. Six cards: intro, distance/status, splits, optional Strava, photos, share. Hide finish/rank claims for nonfinishers. Direct tabs keep photos/export within three actions. Render stock and demo labels.
- [ ] Export: pure share model tests cover finisher, DNF, DNS and unavailable; browser canvas uses that model, local fonts and no cross-origin photo. Render one matching DOM preview. Blob failures surface retryable errors; object URLs released after download. Verify PNG dimensions and contents for two runners and DNF.
- [ ] Organizer: event-scoped results table, inline create/edit form with identity, eligibility, category, raw timing and per-km splits. Retrieve draft through a guarded endpoint; save only via existing atomic API. Refresh authoritative results after save. Preserve failed drafts.
- [ ] Verify: unit/native/live suites, lint, typecheck, production build, desktop/mobile browser flows and exports, one detector run and independent review. Update evidence and roadmap honestly; real Strava OAuth remains deferred by user choice.

Files: lib/authHttp.ts; lib/runnerCatalog.ts; app/api/auth/{login,logout}/route.ts; app/api/session/route.ts; app/api/organizer/events/[eventId]/runners/[runnerId]/route.ts; app/components/{AppHeader,RunnerSelection,RecapStory,OrganizerPanel,SharePreview,Arrow}.tsx and useCatalog.ts; lib/shareModel.ts; lib/exportWrapped.ts; app/{page,login/page,organizer/page,wrapped/[runnerId]/page}.tsx; app/globals.css. Tests target security boundaries and data correctness, not CSS internals.

## Execution checkpoint

All listed implementation files exist. Auth/catalog/draft integration passed against the dedicated database. Core browser story, gallery focus return and Aina/Budi/DNF downloads were exercised. Final source adds authored SVG navigation and explicit export distance labels. 77 unit checks and 10 native checks pass; lint, TypeScript and production build pass. The 14 live checks passed before the local connectivity outage.

Checkboxes remain open because their full acceptance gates are not all discharged: organizer UI save/rejection, current visual recaptures/review, browser failure injection, performance and cross-browser evidence remain open. Independent visual disposition is recapture, not ship. Product/design documentation is written. See [actual evidence](../../qa/connected-ui.md) and [SRS map](../../qa/acceptance-matrix.md).
