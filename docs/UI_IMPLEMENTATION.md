# Connected frontend

The authenticated prototype now uses Supabase-backed results. Start with `npm run build`, then `npm run start -- --port 3007` (or `npm run dev` during development). Sign in using an account mapped to a runner or organizer event. Demo credentials are in the ignored `.env.demo.local`; do not commit or share them.

The supplied local Figma Make export is a read-only reference. Its source and portrait are not copied into the repo. The implementation inherits the red/cream/lime palette, Bricolage typography, six-part story and navigation. Hydration claims are removed because no source measures them.

## Flows

- `/login`: Supabase password sign-in with same-origin writes and private responses.
- `/`: authorized runner selection; organizers see only their event scope.
- `/wrapped/[runnerId]`: intro, distance/status, recorded splits, optional Strava context, BIB-mapped photos and export. Keyboard arrows, direct page buttons and horizontal swipes navigate. DNF/DNS and unpublished results retain honest missing statistics.
- `/organizer`: event results plus atomic create/update of runner identity, eligibility, category, chip timing, splits, optional sample metrics and photo mappings. Failed saves preserve the draft and announce the rejection as an alert; successful saves use a separate status message. BIB stays immutable. Photo URLs must belong to this project's race-photos bucket.

The user chose a disconnected Strava state because no API application exists yet. Seeded sample metrics are labeled as samples; no OAuth success is simulated. Real connection/activity selection/refresh/revocation acceptance remains deferred.

Photos are manually mapped stock samples, labeled as simulated matches. See `public/photos/PROVENANCE.md`. No personalized public link is exposed. The PNG preview and download share one canvas renderer at 1080 × 1350, use the selected runner's data and local fonts, and omit health metrics and cross-origin photos.

## Verification

See `docs/qa/connected-ui.md` for actual command/browser evidence and remaining acceptance limits. Earlier hardcoded-demo claims in this document have been superseded.
