# /lib — Wrapped logic

Owner: **Embun** (logic)

Pure TypeScript functions that turn a runner's data into Wrapped stats. No UI code here.

## Sprint 1 (issue #30)

- `types.ts` — `RunnerChipInput` / `WrappedStats` (see `docs/data-contract.md`)
- `stats.ts` — elapsed, pace, rank, percentile, split analysis, `buildWrappedStats`
- `insights.ts` — card stat lines
- `format.ts` — `formatMmSs`
- `index.ts` — public exports

Indra: `import { buildWrappedStats } from "@/lib"` and render `WrappedStats`. How-to: `docs/wrapped-statistics.md`.
Shaun: `npm test` checks the formulas against `tests/fixtures/runners.ts`.

## Later

- `merge.ts` — chip + optional Strava + FotoYu (issue #37)
- `supabase.ts` — Supabase client
