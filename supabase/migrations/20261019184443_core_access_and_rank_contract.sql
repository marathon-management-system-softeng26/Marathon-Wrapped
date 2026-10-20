-- The browser uses Auth only; application data is served by authorized Next.js routes.
create table public.runner_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  runner_id uuid not null references public.runners(id) on delete cascade,
  primary key (user_id, runner_id)
);
create table public.organizer_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id bigint not null references public.events(id) on delete cascade,
  primary key (user_id, event_id)
);
alter table public.runner_access enable row level security;
alter table public.organizer_access enable row level security;
create index runner_access_runner on public.runner_access(runner_id);
create index organizer_access_event on public.organizer_access(event_id);

alter table public.strava_metrics add column data_source text not null default 'demo'
  check (data_source in ('demo', 'strava'));

alter table public.chip_results add constraint nonfinisher_null_statistics check (
  finisher or (finish_time is null and elapsed_seconds is null and avg_pace_sec_km is null
    and category_rank is null and overall_rank is null)
);
alter table public.chip_results add constraint dns_no_start check (start_status <> 'dns' or start_time is null);

create function public.validate_chip_result() returns trigger
language plpgsql set search_path = '' as $$
declare distance numeric;
begin
  select c.distance_km into distance from public.runners r
    join public.categories c on c.id = r.category_id where r.id = new.runner_id;
  if new.finisher then
    if new.start_time is null or new.finish_time is null or new.elapsed_seconds is null
      or new.avg_pace_sec_km is null or distance is null
      or new.finish_time <= new.start_time
      or new.elapsed_seconds <> round(extract(epoch from (new.finish_time - new.start_time)))
      or abs(new.avg_pace_sec_km - new.elapsed_seconds / distance) > 0.011 then
      raise exception 'Finisher timing must match timestamps and category distance';
    end if;
  end if;
  return new;
end $$;
create trigger chip_result_consistency before insert or update on public.chip_results
  for each row execute function public.validate_chip_result();

create function public.validate_split_marker() returns trigger
language plpgsql set search_path = '' as $$
declare distance numeric;
begin
  select c.distance_km into distance from public.runners r
    join public.categories c on c.id = r.category_id where r.id = new.runner_id;
  if new.km_marker > distance then raise exception 'Split marker exceeds category distance'; end if;
  return new;
end $$;
create trigger split_marker_range before insert or update on public.chip_splits
  for each row execute function public.validate_split_marker();

create or replace view public.runner_wrapped with (security_invoker = true) as
with ranked as (
  select cr.runner_id,
    rank() over (partition by r.category_id order by cr.elapsed_seconds)::int as category_rank,
    rank() over (partition by c.event_id, c.distance_km order by cr.elapsed_seconds)::int as overall_rank,
    percent_rank() over (partition by r.category_id order by cr.elapsed_seconds desc) as category_percentile
  from public.chip_results cr join public.runners r on r.id = cr.runner_id
  join public.categories c on c.id = r.category_id where cr.finisher
)
select r.id as runner_id, r.bib_number, r.name, r.gender,
  public.age_on(r.date_of_birth, e.event_date) as age,
  e.name as event, c.name as category, c.distance_km,
  cr.start_status, cr.elapsed_seconds, cr.avg_pace_sec_km,
  rk.category_rank, rk.overall_rank, cr.finisher, rk.category_percentile,
  sm.avg_heartrate, sm.max_heartrate, sm.elevation_gain_m, sm.calories, sm.avg_cadence,
  (sm.runner_id is not null) as has_strava,
  (select count(*) from public.fotoyu_photos fp where fp.bib_number = r.bib_number) as photo_count
from public.runners r join public.categories c on c.id = r.category_id
join public.events e on e.id = c.event_id
join public.chip_results cr on cr.runner_id = r.id
left join ranked rk on rk.runner_id = r.id
left join public.strava_metrics sm on sm.runner_id = r.id;

revoke all on public.events, public.categories, public.runners, public.chip_results,
  public.chip_splits, public.strava_metrics, public.fotoyu_photos,
  public.runner_wrapped, public.runner_access, public.organizer_access from anon, authenticated;
grant all on public.events, public.categories, public.runners, public.chip_results,
  public.chip_splits, public.strava_metrics, public.fotoyu_photos,
  public.runner_access, public.organizer_access to service_role;
grant select on public.runner_wrapped to service_role;
revoke execute on function public.age_on(date,date), public.check_runner_eligibility(),
  public.lock_bib_number(), public.validate_chip_result(), public.validate_split_marker()
  from public, anon, authenticated;
grant execute on function public.age_on(date,date), public.check_runner_eligibility(),
  public.lock_bib_number(), public.validate_chip_result(), public.validate_split_marker() to service_role;
alter function public.age_on(date,date) set search_path = public;
alter function public.check_runner_eligibility() set search_path = public;
alter function public.lock_bib_number() set search_path = public;
