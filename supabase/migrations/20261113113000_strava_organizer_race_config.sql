-- Organizers configure the race-matching window per category. The original table pinned
-- distance_tolerance_m to exactly 500, which left nothing for an organizer to manage.
-- Replace that equality check with a bounded positive range and keep every other
-- invariant (Run-only sport types, ordered finite window, all-or-none start location).

-- Drop by catalog lookup rather than by a presumed auto-generated name: a `drop constraint
-- if exists <guessed name>` would silently no-op on a mismatch and leave the value pinned,
-- so the organizer control would fail later at the database instead of here.
do $$
declare
  conflicting text;
begin
  for conflicting in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'strava_race_configs'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%distance_tolerance_m%'
  loop
    execute format('alter table public.strava_race_configs drop constraint %I', conflicting);
  end loop;
end $$;

alter table public.strava_race_configs
  add constraint strava_race_config_tolerance
    check (distance_tolerance_m > 0 and distance_tolerance_m <= 5000);

-- Fail the migration rather than ship a table that still pins the value.
do $$
declare
  remaining integer;
begin
  select count(*) into remaining
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'strava_race_configs'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%distance_tolerance_m%';

  if remaining <> 1 then
    raise exception
      'expected exactly one distance_tolerance_m check constraint, found %', remaining;
  end if;

  -- Detect a real equality pin only. A substring test would match the bound in
  -- `distance_tolerance_m <= 5000`, so require `=` not preceded by `<` or `>`.
  if exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'strava_race_configs'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ~ 'distance_tolerance_m[[:space:]]*=[[:space:]]*[0-9]'
  ) then
    raise exception 'distance_tolerance_m is still pinned to a single value';
  end if;
end $$;

-- Matching reads this table for every candidate import, always by category.
create index if not exists strava_race_configs_category on public.strava_race_configs (category_id);

comment on column public.strava_race_configs.distance_tolerance_m is
  'Organizer-set absolute distance tolerance in metres, 1..5000, compared against the category expected distance.';
comment on column public.strava_race_configs.start_latitude is
  'Optional organizer-only start location. Never returned in a runner-facing payload.';
