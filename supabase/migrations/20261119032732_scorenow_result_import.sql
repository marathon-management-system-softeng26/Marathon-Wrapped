-- Public race-result staging imported from ScoreNow. These rows are not trusted
-- Marathon Wrapped registrations and must not be joined to an application user
-- without a separate, explicit identity-verification step.

create table public.scorenow_results (
  id bigint generated always as identity primary key,
  competition_id bigint not null check (competition_id > 0),
  race_id bigint not null check (race_id > 0),
  source_event_id bigint not null check (source_event_id > 0),
  source_uid text not null check (btrim(source_uid) <> ''),
  race_name text not null check (btrim(race_name) <> ''),
  race_date date not null,
  category text not null check (category in ('5K', '10K')),
  position integer check (position is null or position > 0),
  bib_number text not null check (btrim(bib_number) <> ''),
  runner_name text not null check (btrim(runner_name) <> ''),
  official_time text,
  official_time_ms bigint check (official_time_ms is null or official_time_ms >= 0),
  source_category text not null check (btrim(source_category) <> ''),
  category_rank integer check (category_rank is null or category_rank > 0),
  category_total integer check (category_total is null or category_total > 0),
  gender text not null check (btrim(gender) <> ''),
  gender_rank integer check (gender_rank is null or gender_rank > 0),
  gender_total integer check (gender_total is null or gender_total > 0),
  checkpoints jsonb not null check (jsonb_typeof(checkpoints) = 'array'),
  detail_url text not null check (btrim(detail_url) <> ''),
  source_url text not null check (btrim(source_url) <> ''),
  scraped_at timestamptz not null,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scorenow_results_source_key unique (competition_id, race_id, source_event_id, source_uid),
  constraint scorenow_results_time_pair check ((official_time is null) = (official_time_ms is null)),
  constraint scorenow_results_category_rank_pair check (
    (category_rank is null and category_total is null)
    or (category_rank is not null and category_total is not null and category_rank <= category_total)
  ),
  constraint scorenow_results_gender_rank_pair check (
    (gender_rank is null and gender_total is null)
    or (gender_rank is not null and gender_total is not null and gender_rank <= gender_total)
  ),
  constraint scorenow_results_known_event check (
    (source_event_id = 1 and category = '10K')
    or (source_event_id = 2 and category = '5K')
  )
);

create unique index scorenow_results_ranked_position_key
  on public.scorenow_results (competition_id, race_id, source_event_id, position)
  where position is not null;

alter table public.scorenow_results enable row level security;

revoke all on table public.scorenow_results from public, anon, authenticated;
revoke all on sequence public.scorenow_results_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.scorenow_results to service_role;
grant usage, select on sequence public.scorenow_results_id_seq to service_role;

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

comment on table public.scorenow_results is
  'Server-only staging for public ScoreNow race results; not a trusted registration or app-user identity source.';
comment on function public.import_scorenow_results(jsonb) is
  'Service-only idempotent upsert for validated ScoreNow result batches.';
