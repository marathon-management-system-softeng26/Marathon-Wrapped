# Wrapped statistics (`/lib`)

Owner: **Embun** (logic) · Issue **#30** (Sprint 1)

Pure TypeScript helpers that turn one runner's chip payload into the stats Indra renders on Wrapped cards. No UI, no fetch, no Supabase client.

Field names are not invented here. They come from `docs/data-contract.md` and `db/schema.sql`. Formulas live in the contract §5 — this page is how to *use* `/lib`.

## Flow

```
chip_results + chip_splits
        ↓
  RunnerChipInput          (identity + stored chip fields + splits)
        ↓
  buildWrappedStats()
        ↓
  WrappedStats             (same fields + split analysis + insights[])
        ↓
  Indra's cards
```

Sprint 2 (`merge.ts`, issue #37) may attach Strava / FotoYu fields later. Do not populate them in #30.

## For Indra (cards)

```ts
import { buildWrappedStats } from "@/lib";
import type { RunnerChipInput, WrappedStats } from "@/lib";

const wrapped: WrappedStats = buildWrappedStats(input);
// render wrapped.insights, wrapped.fastest_km, wrapped.split_type, …
```

`buildWrappedStats`:

- Copies identity and stored chip fields through unchanged.
- Fills `avg_pace_sec_km` only when `finisher` is true, `elapsed_seconds` is a number, and stored pace is null.
- Always attaches split analysis and `insights`.
- **Does not rerank.** `category_rank` and `overall_rank` are whatever the caller passed (from `runner_wrapped`).

Render `insights` in array order. Do not invent extra lines such as “you passed N people” — the schema has no passing data.

Times on cards should go through `formatMmSs` (or the insight strings, which already do). Raw `first_half_seconds` / `second_half_seconds` are totals, not `mm:ss`.

### DNF and DNS (SR-F6, SR-NF5)

| Case | How to recognise | What `/lib` does |
|---|---|---|
| DNS | `start_status === "dns"` | `insights` is exactly `["Did not start"]`. No finish time, no pace. |
| DNF | `finisher === false` and not DNS | First insight is `Did not finish — no official finish time`. Elapsed, pace, ranks, percentile stay null if the caller passed null. |
| Finisher | `finisher === true` | Finish time, rank, percentile, fastest km, split type as available. |

Never compute pace from splits for a non-finisher. `/lib` will not invent `elapsed_seconds`.

A lone finisher in a category has `category_percentile === 0`, so the card can show “Faster than 0% of your category”. That matches the contract (and Postgres `percent_rank`). Change the copy only with Bella / Harry.

`formatMmSs(4335)` is `72:15` (minutes:seconds, no hours). Same contract.

## For Shaun (QA)

```bash
npm test
```

Fixtures with hand-calculated expectations: `tests/fixtures/runners.ts` (Aina 5K negative, Budi 10K positive, even 5K, Citra DNF, Dewa DNS).

Helpers you can call without a full payload:

| Function | Use |
|---|---|
| `computeElapsedSeconds(start, finish)` | SR-F2: round finish − start to whole seconds |
| `computeAvgPaceSecKm(elapsed, distanceKm)` | SR-F3: elapsed / distance. Do not call on DNF/DNS |
| `rankAmong(elapsed, field)` | SR-F5: `1 + count(strictly faster)`. Ties share the min rank. `field` is finishers only |
| `categoryPercentile(elapsed, field)` | Matches `runner_wrapped` `percent_rank` ordered by elapsed **DESC**. `field` must include **this runner** |
| `analyzeSplits(splits, distanceKm)` | Fastest km, half-race type, `slowed_after_km` |
| `buildInsights(input, analysis)` | The card lines, same order as the contract |

`analyzeSplits` details:

- Fastest km: smallest `split_seconds`; ties → lowest `km_marker`.
- Half-race type only when every km from `1` through `distance_km` is present. 5K drops km 3 (1–2 vs 4–5). 10K is 1–5 vs 6–10.
- `slowed_after_km`: only **adjacent** km markers (`diff === 1`); largest positive delta; none → `null`. A missing km (failed chip) is not compared across the gap.

## Mapping from the database

Build `RunnerChipInput` from `runner_wrapped` plus that runner's `chip_splits` rows. Do not rename columns.

If you load through `pg` / node-postgres, `numeric` columns (`split_seconds`, `avg_pace_sec_km`) arrive as **strings**. Coerce to `number` before calling `/lib`, or sums and comparisons will concatenate or fail.

Private registration fields (`email`, `phone`, `id_type`, `id_number`, `date_of_birth`) never belong on this payload. Age on race day is already on `runner_wrapped`.

## Files

| Path | Role |
|---|---|
| `docs/data-contract.md` | Shared field names, null rules, formulas |
| `lib/types.ts` | Types that match the contract |
| `lib/stats.ts` | Elapsed, pace, rank, percentile, splits, `buildWrappedStats` |
| `lib/insights.ts` | Insight strings |
| `lib/format.ts` | `formatMmSs` |
| `lib/index.ts` | Public exports |
| `lib/README.md` | Short `/lib` surface list |

## Out of scope for #30

- Fetching seed / live chip data (Rakha, #29)
- Strava + FotoYu merge (`merge.ts`, #37)
- Card UI / export (#31, #41)
- Editing `app/` or `db/schema.sql` from this layer
