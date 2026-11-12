-- Add runner-scoped race matching without changing the preserved lifecycle RPCs.
-- No event window/location is seeded: those require an approved race configuration.
create table public.strava_race_configs (
  category_id bigint primary key references public.categories(id) on delete cascade,
  start_time_from timestamptz not null,
  start_time_to timestamptz not null,
  allowed_sport_types text[] not null default array['Run'] check (allowed_sport_types = array['Run']),
  distance_tolerance_m integer not null default 500 check (distance_tolerance_m = 500),
  start_latitude double precision,
  start_longitude double precision,
  start_radius_m double precision,
  check (isfinite(start_time_from) and isfinite(start_time_to) and start_time_from < start_time_to),
  check (
    (start_latitude is null and start_longitude is null and start_radius_m is null)
    or (start_latitude is not null and start_longitude is not null and start_radius_m is not null
      and start_latitude between -90 and 90 and start_longitude between -180 and 180
      and start_radius_m >= 0 and start_radius_m < 'Infinity'::double precision)
  )
);

alter table public.strava_connections add constraint strava_connection_generation unique (user_id, generation);
alter table public.strava_activities add constraint strava_activity_generation unique (user_id, generation, activity_id);
alter table public.strava_oauth_attempts
  add column runner_id uuid,
  add column return_path text,
  add constraint strava_oauth_runner_access foreign key (user_id, runner_id)
    references public.runner_access(user_id, runner_id) on delete cascade,
  add constraint strava_oauth_local_path check (
    (runner_id is null and return_path is null)
    or (runner_id is not null and return_path is not null and return_path = '/wrapped/' || runner_id::text)
  );

create table public.strava_activity_candidates (
  user_id uuid not null,
  generation uuid not null,
  runner_id uuid not null,
  activity_id text not null check (length(activity_id) > 0),
  match_status text not null check (match_status in ('auto_match', 'needs_confirmation', 'no_match')),
  reason text not null check (length(reason) > 0),
  summary jsonb not null default '{}' check (jsonb_typeof(summary) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, generation, runner_id, activity_id),
  unique (generation, runner_id, activity_id),
  foreign key (user_id, runner_id) references public.runner_access(user_id, runner_id) on delete cascade,
  foreign key (user_id, generation) references public.strava_connections(user_id, generation) on delete cascade,
  foreign key (user_id, generation, activity_id)
    references public.strava_activities(user_id, generation, activity_id) on delete cascade
);
create index strava_candidates_runner on public.strava_activity_candidates(runner_id);

create table public.strava_runner_activities (
  runner_id uuid primary key,
  user_id uuid not null,
  generation uuid not null,
  activity_id text not null,
  selected_at timestamptz not null default now(),
  unique (runner_id, user_id, generation, activity_id),
  foreign key (user_id, generation, runner_id, activity_id)
    references public.strava_activity_candidates(user_id, generation, runner_id, activity_id) on delete cascade
);

-- Demo strava_metrics is deliberately separate and never modified by these RPCs.
create table public.strava_live_metrics (
  runner_id uuid primary key,
  user_id uuid not null,
  generation uuid not null,
  activity_id text not null,
  avg_heartrate numeric check (avg_heartrate >= 0 and avg_heartrate < 'Infinity'::numeric),
  max_heartrate numeric check (max_heartrate >= 0 and max_heartrate < 'Infinity'::numeric),
  elevation_gain_m numeric check (elevation_gain_m >= 0 and elevation_gain_m < 'Infinity'::numeric),
  calories numeric check (calories >= 0 and calories < 'Infinity'::numeric),
  avg_cadence numeric check (avg_cadence >= 0 and avg_cadence < 'Infinity'::numeric),
  updated_at timestamptz not null default now(),
  foreign key (runner_id, user_id, generation, activity_id)
    references public.strava_runner_activities(runner_id, user_id, generation, activity_id)
    on delete cascade on update cascade
);

-- The lifecycle changes generation before disconnect/reconnect. Clear dependants
-- in that same transaction, including paths called by webhook/revocation workers.
create function public.strava_cleanup_runner_generation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.generation is distinct from old.generation or new.status <> 'active' then
    delete from public.strava_activity_candidates where user_id = old.user_id;
  end if;
  return new;
end $$;
create trigger strava_cleanup_runner_generation before update of generation, status on public.strava_connections
  for each row execute function public.strava_cleanup_runner_generation();

-- A provider deletion, detail replacement, or reclassification must not leave a
-- selection backed by obsolete details. The worker can select refreshed data again.
create function public.strava_cleanup_activity_selection() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.activity is distinct from old.activity or new.generation is distinct from old.generation then
    delete from public.strava_activity_candidates
      where user_id = old.user_id and generation = old.generation and activity_id = old.activity_id;
  end if;
  return new;
end $$;
create trigger strava_cleanup_activity_selection before update on public.strava_activities
  for each row execute function public.strava_cleanup_activity_selection();

create function public.strava_begin_runner_oauth(p_user uuid, p_runner uuid, p_hash text, p_return_path text)
returns text language plpgsql security definer set search_path = '' as $$
declare result text;
begin
  perform 1 from public.runner_access where user_id = p_user and runner_id = p_runner for key share;
  if not found then raise exception 'Runner access required' using errcode = '42501'; end if;
  if p_return_path is distinct from '/wrapped/' || p_runner::text or p_hash is null or length(p_hash) = 0 then
    raise exception 'Invalid runner OAuth context' using errcode = '22023';
  end if;
  result := public.strava_begin_oauth(p_user, p_hash);
  if result = 'ready' then
    update public.strava_oauth_attempts set runner_id = p_runner, return_path = p_return_path
      where user_id = p_user and state_hash = p_hash;
  end if;
  return result;
end $$;

create function public.strava_claim_runner_oauth(p_user uuid, p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.strava_oauth_attempts; result text;
begin
  -- Match the existing lifecycle's connection -> attempt lock order.
  perform 1 from public.strava_connections where user_id = p_user for update;
  select * into a from public.strava_oauth_attempts
    where user_id = p_user and state_hash = p_hash for update;
  if a.runner_id is null or not exists (
    select 1 from public.runner_access where user_id = p_user and runner_id = a.runner_id
  ) then
    return jsonb_build_object('status','invalid_state','runner_id',null,'return_path',null,'generation',null);
  end if;
  result := public.strava_claim_oauth(p_user, p_hash);
  select * into a from public.strava_oauth_attempts where user_id = p_user and state_hash = p_hash;
  return jsonb_build_object('status',result,'runner_id',a.runner_id,'return_path',a.return_path,'generation',a.generation);
end $$;

create function public.strava_store_runner_candidates(p_user uuid, p_generation uuid, p_runner uuid, p_candidates jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb;
begin
  perform 1 from public.strava_connections where user_id = p_user and generation = p_generation and status = 'active' for update;
  if not found then raise exception 'Obsolete connection' using errcode = '22023'; end if;
  perform 1 from public.runner_access where user_id = p_user and runner_id = p_runner for key share;
  if not found then raise exception 'Runner access required' using errcode = '42501'; end if;
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'Candidates must be an array' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_candidates) loop
    if not exists (select 1 from public.strava_activities where user_id=p_user
      and generation=p_generation and activity_id=item->>'activity_id' and activity is not null) then
      raise exception 'Candidate detail does not exist' using errcode = '23503';
    end if;
    -- Reclassification invalidates any old materialized metrics atomically.
    if item->>'match_status' = 'no_match' then
      delete from public.strava_runner_activities where user_id=p_user and generation=p_generation
        and runner_id=p_runner and activity_id=item->>'activity_id';
    end if;
    insert into public.strava_activity_candidates(user_id,generation,runner_id,activity_id,match_status,reason,summary)
      values (p_user,p_generation,p_runner,item->>'activity_id',item->>'match_status',item->>'reason',coalesce(item->'summary','{}'))
      on conflict (user_id,generation,runner_id,activity_id) do update
        set match_status=excluded.match_status, reason=excluded.reason, summary=excluded.summary, updated_at=now();
  end loop;
end $$;

create function public.strava_select_runner_activity(p_user uuid, p_generation uuid, p_runner uuid, p_activity text, p_metrics jsonb)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.strava_connections where user_id=p_user and generation=p_generation and status='active' for update;
  if not found then return 'obsolete'; end if;
  perform 1 from public.runner_access where user_id=p_user and runner_id=p_runner for key share;
  if not found then return 'forbidden'; end if;
  perform 1 from public.strava_activity_candidates c join public.strava_activities a
    on a.user_id=c.user_id and a.generation=c.generation and a.activity_id=c.activity_id
    where c.user_id=p_user and c.generation=p_generation and c.runner_id=p_runner and c.activity_id=p_activity
      and c.match_status in ('auto_match','needs_confirmation') and a.activity is not null;
  if not found then return 'invalid_candidate'; end if;
  if p_metrics is null or jsonb_typeof(p_metrics) <> 'object' or exists (
    select 1 from jsonb_each(p_metrics) m where m.key not in ('avg_heartrate','max_heartrate','elevation_gain_m','calories','avg_cadence')
      or jsonb_typeof(m.value) not in ('number','null')
  ) then raise exception 'Invalid metric fields' using errcode='22023'; end if;

  insert into public.strava_runner_activities(runner_id,user_id,generation,activity_id)
    values (p_runner,p_user,p_generation,p_activity)
    on conflict (runner_id) do update set user_id=excluded.user_id, generation=excluded.generation, activity_id=excluded.activity_id,
      selected_at=case when public.strava_runner_activities.activity_id=excluded.activity_id
        and public.strava_runner_activities.generation=excluded.generation then public.strava_runner_activities.selected_at else now() end;
  insert into public.strava_live_metrics(runner_id,user_id,generation,activity_id,avg_heartrate,max_heartrate,elevation_gain_m,calories,avg_cadence)
    values (p_runner,p_user,p_generation,p_activity,(p_metrics->>'avg_heartrate')::numeric,(p_metrics->>'max_heartrate')::numeric,
      (p_metrics->>'elevation_gain_m')::numeric,(p_metrics->>'calories')::numeric,(p_metrics->>'avg_cadence')::numeric)
    on conflict (runner_id) do update set user_id=excluded.user_id,generation=excluded.generation,activity_id=excluded.activity_id,
      avg_heartrate=excluded.avg_heartrate,max_heartrate=excluded.max_heartrate,elevation_gain_m=excluded.elevation_gain_m,
      calories=excluded.calories,avg_cadence=excluded.avg_cadence,updated_at=now();
  return 'selected';
end $$;

create function public.strava_clear_live_selection(p_user uuid, p_generation uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.strava_connections where user_id=p_user and generation=p_generation for update;
  if not found then return; end if;
  delete from public.strava_runner_activities where user_id=p_user and generation=p_generation;
end $$;

alter table public.strava_race_configs enable row level security;
alter table public.strava_activity_candidates enable row level security;
alter table public.strava_runner_activities enable row level security;
alter table public.strava_live_metrics enable row level security;
revoke all on public.strava_race_configs, public.strava_activity_candidates, public.strava_runner_activities, public.strava_live_metrics
  from public, anon, authenticated;
grant select, insert, update, delete on public.strava_race_configs, public.strava_activity_candidates, public.strava_runner_activities, public.strava_live_metrics
  to service_role;
revoke all on function public.strava_begin_runner_oauth(uuid,uuid,text,text), public.strava_claim_runner_oauth(uuid,text),
  public.strava_store_runner_candidates(uuid,uuid,uuid,jsonb), public.strava_select_runner_activity(uuid,uuid,uuid,text,jsonb),
  public.strava_clear_live_selection(uuid,uuid), public.strava_cleanup_runner_generation(), public.strava_cleanup_activity_selection()
  from public, anon, authenticated;
grant execute on function public.strava_begin_runner_oauth(uuid,uuid,text,text), public.strava_claim_runner_oauth(uuid,text),
  public.strava_store_runner_candidates(uuid,uuid,uuid,jsonb), public.strava_select_runner_activity(uuid,uuid,uuid,text,jsonb),
  public.strava_clear_live_selection(uuid,uuid), public.strava_cleanup_runner_generation(), public.strava_cleanup_activity_selection()
  to service_role;
