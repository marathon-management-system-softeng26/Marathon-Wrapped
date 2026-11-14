begin;

-- These assertions catch the organizer distance tolerance silently staying pinned to 500,
-- and the window / start-location invariants being relaxed along with it.
do $$
declare
  event bigint;
  category bigint;
  pinned integer;
begin
  insert into public.events (name, event_date) values ('Tolerance assertion', '2027-08-17')
    returning id into event;
  insert into public.categories (event_id, name, distance_km, min_age)
    values (event, '5K', 5, 17) returning id into category;

  -- Exactly one check constraint governs the column, and it is not an equality pin.
  select count(*) into pinned
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'strava_race_configs'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%distance_tolerance_m%';
  if pinned <> 1 then
    raise exception 'expected one distance_tolerance_m check, found %', pinned;
  end if;

  -- An organizer-chosen tolerance other than the old fixed 500 must be storable.
  insert into public.strava_race_configs
    (category_id, start_time_from, start_time_to, distance_tolerance_m)
  values (category, '2027-08-17T00:00:00Z', '2027-08-17T02:00:00Z', 400);

  update public.strava_race_configs set distance_tolerance_m = 1 where category_id = category;
  update public.strava_race_configs set distance_tolerance_m = 5000 where category_id = category;

  -- Out-of-range values stay rejected at the database.
  begin
    update public.strava_race_configs set distance_tolerance_m = 0 where category_id = category;
    raise exception 'zero tolerance was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.strava_race_configs set distance_tolerance_m = -1 where category_id = category;
    raise exception 'negative tolerance was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.strava_race_configs set distance_tolerance_m = 5001 where category_id = category;
    raise exception 'unbounded tolerance was accepted';
  exception when check_violation then null;
  end;

  -- Every other invariant survives the constraint replacement.
  begin
    update public.strava_race_configs set allowed_sport_types = array['Ride'] where category_id = category;
    raise exception 'non-Run sport type was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.strava_race_configs
      set start_time_from = '2027-08-17T03:00:00Z' where category_id = category;
    raise exception 'inverted window was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.strava_race_configs set start_latitude = -6.175392 where category_id = category;
    raise exception 'partial start location was accepted';
  exception when check_violation then null;
  end;

  update public.strava_race_configs
    set start_latitude = -6.175392, start_longitude = 106.827153, start_radius_m = 250
    where category_id = category;

  -- The browser roles must never reach organizer race configuration.
  if has_table_privilege('authenticated', 'public.strava_race_configs', 'select')
     or has_table_privilege('anon', 'public.strava_race_configs', 'select') then
    raise exception 'race configuration is readable by a browser role';
  end if;
end $$;

rollback;
