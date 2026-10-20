# Connected UI evidence — October 20, 2026

Environment: Windows, Node 24.16.0, Next production server at http://127.0.0.1:3007; dedicated Singapore Supabase marathon-wrapped (`anbnuegocddoowagqmxw`), eight synthetic runners. Figma source reference remained untouched outside this worktree.

## Automated checks

- Final unit suite: 77 passed; 14 live checks intentionally skipped by this command.
- Native input boundary: 10 passed.
- Live integration: 14 passed, including login-handler cookies across catalog and nested recap, exact runner mapping, organizer scope, protected private drafts and atomic management. Opt-in suite is skipped by the regular unit command; its separate run is the database evidence.
- Auth outage regression: a retryable Supabase fetch error initially produced an AuthenticationError; fixed to return service failure instead of forcing sign-in. Login similarly distinguishes network/rate/server failure from incorrect credentials.
- Organizer review found hidden 10K splits survived a move to 5K. Added category-change regression and removed out-of-distance draft splits.
- Final lint, TypeScript and production build pass. Native suite: 10 passed. The 14 live checks passed earlier before the connectivity outage; no fresh final database run is claimed.

## Browser evidence

Desktop 1280 × 900 and mobile 390 × 844. Local screenshots/exports under ignored `.impeccable/review/`.

- Password sign-in and authorized catalog exercised with synthetic runner A and organizer accounts.
- Aina: 5K, 25:23, 5:05/km; fastest km 5 at 4:50. Split/Strava/photo/share cards inspected. Strava is explicitly disconnected; sample metrics are labeled. Stock photo opens in native dialog, closes, and returns focus to its opener.
- Aina and Budi downloaded actual PNGs through the browser download event; files opened and visually inspected. Both 1080 × 1350; distinct identities, distances, timing and ranks. Shared canvas renderer supplies both visible preview and export. No health metrics included.
- DNF browser journey showed null finish time/pace and preserved status; actual DNF PNG downloaded and inspected. The final source adds explicit Category distance below its 5K category, pending recapture.
- Connection was intermittently interrupted by local DNS failures. A read-only Node lookup returned ENOTFOUND and resolve4 returned ECONNREFUSED. A QA-only process routing probe using a freshly resolved public address retained TLS verification but still timed out; it was stopped and remains ignored outside shipping code. No system DNS settings changed. Do not interpret an uncompleted browser action or timeout as a passing acceptance check.

## Design checks

Impeccable detector ran once on changed UI targets. One warning: system Arial body stack. It is retained for readable Operate forms/data, as permitted by the skill; Experience headings use locally hosted Bricolage. No hook was active. Independent source review found no concrete authorization bypass or private-field leak. Follow-up source review found no important defects in the category/auth fixes, with browser/refresh limitations disclosed. Token-bearing DESIGN.md and .impeccable/design.json were produced by the independent documenter and checked against actual source.

## Outstanding evidence

Independent visual review disposition: **recapture**. No craft verdict yet: mobile.png showed step 2 rather than the intro, viewport/full-page sizes differed, and captures predated the final authored SVG arrows and export distance labels. Required recaptures: consistent 1280×900 desktop / 390×844 mobile, mobile intro, login at both sizes, six story states, selection, DNF, and three current PNG downloads. Current images remain development evidence, not final approval.

Organizer browser save/rejection, final visual recaptures/review, 20 consecutive usable-page timing, request-trace counts, cross-browser acceptance and final rehearsal remain open. [SRS traceability](acceptance-matrix.md) records these gaps. Real Strava OAuth is deferred by the user's explicit no-app/disconnected-state decision. The current implementation must not be described as full original-SRS acceptance.
