# Runner Data Contract

Owner: **Bella** (contract) · **Embun** (computed stats) · Issue 02 / 05

Per-runner shape passed **database → `/lib` → `/app`**. Field names follow `supabase/migrations/20261019155810_initial_schema.sql` and additive migrations. Do not rename them in TypeScript.

Issue #27 closed this contract; the file was missing from the repo and is restored here from the schema + SRS v1.1.

## 1. Identity and chip fields (from `runner_wrapped`)

| Field | Type | Required | Null when |
|---|---|---|---|
| `runner_id` | uuid string | yes | never |
| `bib_number` | string | yes after assignment | before a bib is assigned |
| `name` | string | yes | never |
| `gender` | `"M"` \| `"F"` | yes | never |
| `age` | int | yes | never (age on race day, not date of birth) |
| `event` | string | yes | never |
| `category` | `"5K"` \| `"10K"` | yes | never |
| `distance_km` | number | yes | never (`5` or `10`) |
| `start_status` | `"on-time"` \| `"late"` \| `"dns"` | yes | never |
| `elapsed_seconds` | int | finishers only | DNF / DNS |
| `avg_pace_sec_km` | number | finishers only | DNF / DNS |
| `category_rank` | int | finishers only | DNF / DNS |
| `overall_rank` | int | finishers only | DNF / DNS |
| `category_percentile` | number 0..1 | finishers only | DNF / DNS |
| `finisher` | boolean | yes | never (`false` = DNF or DNS) |

Private registration fields (`email`, `phone`, `id_type`, `id_number`, `date_of_birth`) never appear on this payload.

## 2. Splits (from `chip_splits`)

| Field | Type | Notes |
|---|---|---|
| `splits` | `{ km_marker: int, split_seconds: number }[]` | One row per recorded km. Missing km = failed chip read. |

## 3. Computed by `/lib` (issue #30)

| Field | Type | Null when |
|---|---|---|
| `fastest_km` | `{ km_marker, split_seconds }` | no splits |
| `split_type` | `"negative"` \| `"positive"` \| `"even"` | splits are incomplete for `distance_km` |
| `first_half_seconds` | number | `split_type` is null |
| `second_half_seconds` | number | `split_type` is null |
| `slowed_after_km` | int | never slowed, or fewer than two consecutive km markers |
| `insights` | string[] | never (may be a one-line DNF/DNS array) |

## 4. Reserved for Sprint 2 (do not populate in #30)

`has_strava`, `avg_heartrate`, `max_heartrate`, `elevation_gain_m`, `calories`, `avg_cadence`, `photo_count`, `photos`.

## 5. Formulas

### Elapsed (SR-F2)

`elapsed_seconds = round((finish_time - start_time) / 1 second)`

Only for a finisher. `/lib` does not invent a finish from splits.

### Average pace (SR-F3)

`avg_pace_sec_km = elapsed_seconds / distance_km`

Never calculated when `finisher` is false.

### Category / overall rank (SR-F5)

Lower elapsed is better. The Wrapped view derives these ranks from current finisher data; manually stored rank columns are no longer authoritative. Category rank partitions by category; overall rank partitions by event and distance, across genders. The UI labels it “Overall in 5K/10K”; raw 5K and 10K times never compete. This is the October 20 implementation policy for OD-02, not a claim of earlier team agreement.

`rank = 1 + (count of finishers with strictly smaller elapsed_seconds)`

Ties share the minimum rank. DNF / DNS are excluded from the field.

`/lib` exposes `rankAmong(elapsedSeconds, peerElapsedSeconds)` so Shaun can check seed ranks. `buildWrappedStats` **passes through** stored `category_rank` and `overall_rank`; it does not rerank a single runner.

### Category percentile

Matches `runner_wrapped`: Postgres `percent_rank() OVER (PARTITION BY category ORDER BY elapsed_seconds DESC)`.

- Slowest finisher → `0`
- Fastest untied finisher → `1`; tied fastest finishers may be below `1` because tied peers are not counted as slower
- One finisher → `0`
- DNF / DNS → `null`

```
rank = 1 + (count of finishers with strictly larger elapsed_seconds)
percentile = (n <= 1) ? 0 : (rank - 1) / (n - 1)
```

Example: elapsed `[2100, 1800, 1523]` → percentiles `{2100: 0, 1800: 0.5, 1523: 1}`.

### Fastest kilometre (SR-F7)

Among available splits, the row with the smallest `split_seconds`. Ties go to the lowest `km_marker`.

### Negative / positive / even split (SR-F7)

Only when every km from `1` through `distance_km` is present.

- Half size `h = floor(distance_km / 2)`
- First half = km `1..h`
- Second half = km `(distance_km - h + 1)..distance_km`
- 5K drops km 3; 10K uses 1–5 vs 6–10

```
tolerance = h   // 1 second per half-km
if |first - second| <= tolerance → even
if second < first → negative
else → positive
```

### Where they slowed

Compare only pairs whose `km_marker` differs by 1. `slowed_after_km` is the earlier km of the pair with the largest positive delta. No positive delta → `null`. Tied deltas → earlier km.

### Insights

Fixed strings, in this order, omitting any line whose input is null:

1. DNS: `Did not start`
2. DNF (not DNS): `Did not finish — no official finish time`
3. Finisher: `Finish time {mm:ss}`
4. `Category rank {n}`
5. `Faster than {round(percentile * 100)}% of your category`
6. `Fastest kilometre: km {n} in {mm:ss}`
7. Negative: `Negative split — second half faster than the first`
8. Positive: `Positive split — second half slower than the first`
9. Even: `Even split — both halves within 1 second per kilometre`

`mm:ss` uses `formatMmSs`: `270` → `4:30`.

Do **not** generate “you passed N people”. No passing data exists.

## 6. Flow

`chip_results` + `chip_splits` → `RunnerChipInput` → `buildWrappedStats` → `WrappedStats` → Indra's cards.

Sprint 2 (`merge.ts`) may add reserved optional fields without renaming anything above.
