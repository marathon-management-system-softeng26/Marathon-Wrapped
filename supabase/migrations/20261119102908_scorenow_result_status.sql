-- Preserve ScoreNow's explicit CUT/DNF/DNS outcome and allow corrected rankings
-- to swap positions across bounded import batches. Whole-artifact validation
-- enforces final position uniqueness before the first RPC call.

alter table public.scorenow_results
  add column result_status text
  check (result_status is null or result_status in ('CUT', 'DNF', 'DNS'));

drop index if exists public.scorenow_results_ranked_position_key;

create or replace function public.import_scorenow_results(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  insert into public.scorenow_results (
    competition_id,
    race_id,
    source_event_id,
    source_uid,
    race_name,
    race_date,
    category,
    position,
    bib_number,
    runner_name,
    result_status,
    official_time,
    official_time_ms,
    source_category,
    category_rank,
    category_total,
    gender,
    gender_rank,
    gender_total,
    checkpoints,
    detail_url,
    source_url,
    scraped_at
  )
  select
    row.competition_id,
    row.race_id,
    row.source_event_id,
    row.source_uid,
    row.race_name,
    row.race_date,
    row.category,
    row.position,
    row.bib_number,
    row.runner_name,
    row.result_status,
    row.official_time,
    row.official_time_ms,
    row.source_category,
    row.category_rank,
    row.category_total,
    row.gender,
    row.gender_rank,
    row.gender_total,
    row.checkpoints,
    row.detail_url,
    row.source_url,
    row.scraped_at
  from jsonb_to_recordset(p_rows) as row (
    competition_id bigint,
    race_id bigint,
    source_event_id bigint,
    source_uid text,
    race_name text,
    race_date date,
    category text,
    position integer,
    bib_number text,
    runner_name text,
    result_status text,
    official_time text,
    official_time_ms bigint,
    source_category text,
    category_rank integer,
    category_total integer,
    gender text,
    gender_rank integer,
    gender_total integer,
    checkpoints jsonb,
    detail_url text,
    source_url text,
    scraped_at timestamptz
  )
  on conflict (competition_id, race_id, source_event_id, source_uid)
  do update set
    race_name = excluded.race_name,
    race_date = excluded.race_date,
    category = excluded.category,
    position = excluded.position,
    bib_number = excluded.bib_number,
    runner_name = excluded.runner_name,
    result_status = excluded.result_status,
    official_time = excluded.official_time,
    official_time_ms = excluded.official_time_ms,
    source_category = excluded.source_category,
    category_rank = excluded.category_rank,
    category_total = excluded.category_total,
    gender = excluded.gender,
    gender_rank = excluded.gender_rank,
    gender_total = excluded.gender_total,
    checkpoints = excluded.checkpoints,
    detail_url = excluded.detail_url,
    source_url = excluded.source_url,
    scraped_at = excluded.scraped_at,
    updated_at = now();

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.import_scorenow_results(jsonb) from public, anon, authenticated;
grant execute on function public.import_scorenow_results(jsonb) to service_role;

comment on column public.scorenow_results.result_status is
  'Literal ScoreNow outcome badge for unranked results: CUT, DNF, or DNS.';
