-- Demo-only per-kilometre estimates for published results that lack real split data.
-- The source checkpoint table remains unchanged; the application labels these rows as estimated.
alter table public.official_race_results
  add column if not exists mock_splits jsonb not null default '[]'::jsonb;

alter table public.official_race_results
  drop constraint if exists official_race_results_mock_splits_array;

alter table public.official_race_results
  add constraint official_race_results_mock_splits_array
  check (jsonb_typeof(mock_splits) = 'array');

comment on column public.official_race_results.mock_splits is
  'Deterministic demo-only per-kilometre estimates derived from the official finish time; not chip timing data.';
