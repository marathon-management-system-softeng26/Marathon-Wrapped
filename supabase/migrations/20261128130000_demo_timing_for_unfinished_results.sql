-- Demo-only timing for records without a published finish time.
-- These values are intentionally separate from official timing and are labeled in the Wrapped UI.
alter table public.official_race_results
  add column if not exists mock_finish_time_ms bigint,
  add column if not exists mock_net_time_ms bigint;

alter table public.official_race_results
  add constraint official_race_results_mock_timing_positive
  check (
    (mock_finish_time_ms is null and mock_net_time_ms is null)
    or (mock_finish_time_ms > 0 and mock_net_time_ms > 0)
  );

with seeded as (
  select
    runner_id,
    distance,
    case when distance = '5K' then 1800000 else 3600000 end
      + (abs(hashtext(runner_id::text)) % 900000) as total_ms
  from public.official_race_results
  where status in ('dnf', 'dns')
    and mock_finish_time_ms is null
), weighted as (
  select seeded.*, km,
    95 + (abs(hashtext(runner_id::text || ':' || km::text)) % 11) as weight
  from seeded
  cross join lateral generate_series(1, case when distance = '5K' then 5 else 10 end) as series(km)
), totals as (
  select weighted.*, sum(weight) over (partition by runner_id) as weight_total,
    sum(weight) over (partition by runner_id order by km rows between unbounded preceding and current row) as cumulative_weight
  from weighted
), split_rows as (
  select
    runner_id,
    total_ms,
    km,
    case when km = max(km) over (partition by runner_id)
      then total_ms - coalesce(sum(round(total_ms * weight / weight_total)) over (partition by runner_id order by km rows between unbounded preceding and 1 preceding), 0)
      else round(total_ms * weight / weight_total)
    end as split_ms
  from totals
), elapsed_rows as (
  select *, sum(split_ms) over (partition by runner_id order by km) as elapsed_ms
  from split_rows
), aggregated as (
  select
    runner_id,
    max(total_ms) as total_ms,
    jsonb_agg(jsonb_build_object(
      'kilometer', km,
      'distanceMeters', km * 1000,
      'splitSeconds', split_ms / 1000.0,
      'elapsedSeconds', elapsed_ms / 1000.0
    ) order by km) as splits
  from elapsed_rows
  group by runner_id
)
update public.official_race_results result
set mock_finish_time_ms = aggregated.total_ms,
    mock_net_time_ms = aggregated.total_ms,
    mock_splits = aggregated.splits
from aggregated
where result.runner_id = aggregated.runner_id;
