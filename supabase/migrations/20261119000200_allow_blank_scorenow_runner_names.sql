-- Some unranked ScoreNow rows intentionally expose an empty name cell. Preserve
-- the public source literally rather than dropping the row or inventing identity data.
alter table public.scorenow_results
  drop constraint if exists scorenow_results_runner_name_check;

comment on column public.scorenow_results.runner_name is
  'Literal public source value. Non-null, but may be empty when ScoreNow publishes no runner name.';
