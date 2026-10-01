# Figma frontend implementation

The home page implements the six recap frames from MNC ui/ux: intro, distance, splits, hydration, gallery, and sharing. Styling follows the lower row of frames (red gradient, cream panels, lime accents). Arrow buttons, keyboard arrow navigation, direct step selection, gallery previews, PNG download, and copy-demo-link are implemented.

Run `npm run dev` and open http://localhost:3000.

## Demo data and design differences

- One sample 10K runner is hardcoded in `app/page.tsx`. Finish time, pace, fastest kilometer, and half comparison are calculated from the same split array.
- The Figma example's 48:09 finish and 5:58 pace are inconsistent for 10K. The implementation displays the calculated 4:49/km.
- The original portrait asset is unavailable locally; a temporary runner illustration is used.
- Gallery gradients reproduce the Figma placeholders; they are not actual matched photos.
- Hydration is static sample data, not a chip-derived metric or an SRS v2 requirement.
- Export generates a PNG summary. Copy link opens the demo, not a personalized runner link.

## SRS v2 integration remaining

The authenticated GitHub SRS_v2.md (version 1.1, September 29, 2026) was reviewed. This frontend slice is not full SRS compliance. Still required: Supabase result retrieval, runner selection/identity isolation, category and overall rankings, DNF and absent-photo states, real Strava OAuth/metrics/disconnect, organizer management, complete hero-runner seeds, and resilience/performance testing. No connections or OAuth are simulated as real functionality.

## Verification

ESLint and TypeScript pass. Browser navigation and computed split text were checked against the sample array. Mobile layout was checked at 390 × 844. PNG export reaches the success state; the browser automation download-event check timed out, so the downloaded file itself was not inspected. The production build passes with `npm run build -- --webpack`; default Turbopack encounters an environment port-permission error.
