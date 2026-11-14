create function public.strava_claim_job_internal(p_projection boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.strava_connections;
  j public.strava_jobs;
begin
  select sc.* into c
  from public.strava_connections sc
  where sc.status in ('active', 'disconnecting')
    and (
      sc.status = 'disconnecting'
      or not exists (
        select 1
        from public.strava_connections throttled
        where throttled.rate_limited_until > now()
      )
    )
    and not exists (
      select 1
      from public.strava_jobs busy
      where busy.user_id = sc.user_id
        and busy.status = 'processing'
        and busy.lease_until > now()
    )
    and exists (
      select 1
      from public.strava_jobs due
      where due.user_id = sc.user_id
        and due.generation = sc.generation
        and (p_projection or due.kind <> 'project')
        and due.available_at <= now()
        and (
          due.status = 'pending'
          or (due.status = 'processing' and due.lease_until <= now())
        )
    )
  order by sc.user_id
  for update skip locked
  limit 1;

  if c.user_id is null then
    return null;
  end if;

  -- A competing claim can commit after this statement's original snapshot.
  if exists (
    select 1
    from public.strava_jobs
    where user_id = c.user_id
      and status = 'processing'
      and lease_until > now()
  ) then
    return null;
  end if;

  select * into j
  from public.strava_jobs
  where user_id = c.user_id
    and generation = c.generation
    and (p_projection or kind <> 'project')
    and available_at <= now()
    and (status = 'pending' or (status = 'processing' and lease_until <= now()))
  order by available_at, id
  for update skip locked
  limit 1;

  if j.attempts >= 8 then
    if j.kind='project' then
      perform public.strava_finish_wrapped_snapshot(j.user_id,j.generation,(j.payload->>'runner_id')::uuid,
        j.payload->>'activity_id',(j.payload->>'version')::integer,(j.payload->>'build_id')::uuid,
        'failed',null,'lease_retry_limit');
    end if;
    update public.strava_jobs
    set status = 'failed',
        last_error = 'lease_retry_limit',
        lease_id = null,
        lease_until = null
    where id = j.id;

    return null;
  end if;

  update public.strava_jobs
  set status = 'processing',
      attempts = attempts + 1,
      lease_id = gen_random_uuid(),
      lease_until = now() + interval '2 minutes'
  where id = j.id
  returning * into j;

  return to_jsonb(j);
end
$$;

create or replace function public.strava_claim_job() returns jsonb language sql security invoker set search_path='' as $$
  select public.strava_claim_job_internal(false)
$$;
create function public.strava_claim_projection_aware_job() returns jsonb language sql security invoker set search_path='' as $$
  select public.strava_claim_job_internal(true)
$$;
revoke all on function public.strava_claim_job_internal(boolean), public.strava_claim_projection_aware_job() from public,anon,authenticated;
grant execute on function public.strava_claim_job_internal(boolean), public.strava_claim_projection_aware_job() to service_role;
create or replace function public.strava_fail_projection_job(p_job uuid,p_lease uuid,p_error text,p_delay integer,p_reauth boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.strava_jobs; c public.strava_connections; incarnation text;
begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  select * into c from public.strava_connections where user_id=j.user_id for update;
  select * into j from public.strava_jobs where id=p_job for update;
  if j.id is null or j.kind<>'project' or j.status<>'processing' or j.lease_id is distinct from p_lease
    or j.lease_until<=now() or c.status<>'active' or c.generation<>j.generation then return false; end if;
  select attachment_id::text into incarnation from public.strava_runner_attachments
    where user_id=j.user_id and generation=j.generation and runner_id::text=j.payload->>'runner_id' and status='active';
  if incarnation is distinct from j.attachment_fences->>(j.payload->>'runner_id') or incarnation is null
    or not exists(select 1 from public.strava_runner_activities s join public.strava_wrapped_snapshots w
      on w.user_id=s.user_id and w.generation=s.generation and w.runner_id=s.runner_id and w.activity_id=s.activity_id
      where s.user_id=j.user_id and s.generation=j.generation and s.runner_id::text=j.payload->>'runner_id'
        and s.activity_id=j.payload->>'activity_id' and w.version::text=j.payload->>'version'
        and w.build_id::text=j.payload->>'build_id' and w.status='building') then
    return public.strava_commit_job(p_job,p_lease);
  end if;
  if incarnation is not distinct from j.attachment_fences->>(j.payload->>'runner_id') and incarnation is not null
    and (p_delay is null or j.attempts>=8) then
    perform public.strava_finish_wrapped_snapshot(j.user_id,j.generation,(j.payload->>'runner_id')::uuid,
      j.payload->>'activity_id',(j.payload->>'version')::integer,(j.payload->>'build_id')::uuid,'failed',null,p_error);
  end if;
  return public.strava_commit_job(p_job,p_lease,p_error=>p_error,p_delay=>p_delay,p_reauth=>p_reauth);
end $$;

-- Upgrade selections made before projection jobs existed. Connection locks
-- precede access/selection/job locks, matching the live worker and detach path.
-- Each statement handles at most 100 selections; each snapshot and job is
-- inserted in the same transaction, and existing ready/building rows win.
create or replace function public.strava_backfill_selected_projections()
returns integer language plpgsql security definer set search_path='' as $$
declare connection record; batch_count integer; total integer:=0;
begin
  for connection in
    select c.user_id,c.generation from public.strava_connections c
      where c.status='active' and exists(select 1 from public.strava_runner_activities s
        where s.user_id=c.user_id and s.generation=c.generation)
      order by c.user_id
  loop
    perform 1 from public.strava_connections c where c.user_id=connection.user_id
      and c.generation=connection.generation and c.status='active' for update;
    if not found then continue; end if;
    loop
      with eligible as materialized (
        select s.user_id,s.generation,s.runner_id,s.activity_id
        from public.strava_runner_activities s
        join public.runner_access access on access.user_id=s.user_id and access.runner_id=s.runner_id
        join public.strava_runner_attachments attachment on attachment.user_id=s.user_id
          and attachment.generation=s.generation and attachment.runner_id=s.runner_id and attachment.status='active'
        join public.strava_connections c on c.user_id=s.user_id and c.generation=s.generation and c.status='active'
        join public.strava_activity_candidates candidate on candidate.user_id=s.user_id and candidate.generation=s.generation
          and candidate.runner_id=s.runner_id and candidate.activity_id=s.activity_id
        join public.strava_activities detail on detail.user_id=s.user_id and detail.generation=s.generation and detail.activity_id=s.activity_id
        where s.user_id=connection.user_id and s.generation=connection.generation
          and public.strava_runner_opted_in(s.user_id,s.generation,s.runner_id)
          and (candidate.match_status='auto_match' or (s.selection_source='manual' and candidate.match_status='needs_confirmation'))
          and jsonb_typeof(detail.activity)='object' and detail.activity->>'id'=s.activity_id
          and detail.activity->>'athleteId'=c.athlete_id and detail.activity->>'sportType'='Run'
          and not exists(select 1 from public.strava_wrapped_snapshots existing
            where existing.user_id=s.user_id and existing.generation=s.generation and existing.runner_id=s.runner_id
              and existing.activity_id=s.activity_id and existing.version=1 and (existing.status='ready' or
                (existing.status='building' and exists(select 1 from public.strava_jobs j
                  where j.user_id=s.user_id and j.generation=s.generation and j.kind='project'
                    and j.payload->>'runner_id'=s.runner_id::text and j.payload->>'activity_id'=s.activity_id
                    and j.payload->>'version'='1' and j.payload->>'build_id'=existing.build_id::text
                    and j.attachment_fences->>s.runner_id::text=attachment.attachment_id::text
                    and ((j.status='pending' and j.attempts<8) or (j.status='processing' and (j.lease_until>now() or j.attempts<8)))))))
        order by s.runner_id limit 100
        for key share of access,s,candidate,detail
      ), cancelled as (
        delete from public.strava_jobs j using eligible s
          where j.user_id=s.user_id and j.generation=s.generation and j.kind='project'
            and j.payload->>'runner_id'=s.runner_id::text and j.status in ('pending','processing')
        returning j.id
      ), snapshots as (
        insert into public.strava_wrapped_snapshots(user_id,generation,runner_id,activity_id,version)
          select s.user_id,s.generation,s.runner_id,s.activity_id,1 from eligible s
            cross join (select count(*) from cancelled) cancelled_count
          on conflict(user_id,generation,runner_id,activity_id,version) do update
            set status='building',payload=null,error_code=null,build_id=gen_random_uuid(),updated_at=now()
            where public.strava_wrapped_snapshots.status in ('failed','building')
          returning user_id,generation,runner_id,activity_id,version,build_id
      )
      insert into public.strava_jobs(user_id,generation,kind,dedupe_key,payload)
        select user_id,generation,'project','project:'||build_id::text,
          jsonb_build_object('runner_id',runner_id,'activity_id',activity_id,'version',version,'build_id',build_id)
        from snapshots;
      get diagnostics batch_count=row_count;
      total:=total+batch_count;
      exit when batch_count<100;
    end loop;
  end loop;
  return total;
end $$;

revoke all on function public.strava_backfill_selected_projections() from public,anon,authenticated;
grant execute on function public.strava_backfill_selected_projections() to service_role;

-- Invalidate project leases issued by the old claim RPC during rollout. The old
-- worker cannot subsequently complete them, and the new claim path can retry.
do $$
declare c record;
begin
  for c in select distinct user_id from public.strava_jobs where kind='project' and status='processing' order by user_id loop
    perform 1 from public.strava_connections where user_id=c.user_id for update;
    update public.strava_jobs set status='pending',lease_id=null,lease_until=null,available_at=now()
      where user_id=c.user_id and kind='project' and status='processing';
  end loop;
end $$;

select public.strava_backfill_selected_projections();
create function public.strava_valid_snapshot_v1(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; field text; n numeric;
  root_keys text[]:=array['version','runner','event','distanceMeters','movingTimeSeconds','elapsedTimeSeconds','averagePaceSecondsPerKm','averageSpeedMps','maxSpeedMps','splits','fastestKilometer','slowestKilometer','paceTrend','averageHeartrate','maxHeartrate','elevationGainMeters','calories','averageCadence'];
begin
  if jsonb_typeof(p)<>'object' or not (p ?& root_keys) or p-root_keys<>'{}'::jsonb or p->'version'<>'1'::jsonb then return false; end if;
  item:=p->'runner';
  if jsonb_typeof(item)<>'object' or not (item ?& array['id','name','bibNumber']) or item-array['id','name','bibNumber']<>'{}'::jsonb
    or jsonb_typeof(item->'id')<>'string' or jsonb_typeof(item->'name')<>'string' or jsonb_typeof(item->'bibNumber') not in ('null','string') then return false; end if;
  item:=p->'event';
  if jsonb_typeof(item)<>'object' or not (item ?& array['name','date','category']) or item-array['name','date','category']<>'{}'::jsonb
    or jsonb_typeof(item->'name')<>'string' or jsonb_typeof(item->'date')<>'string' or jsonb_typeof(item->'category')<>'string' then return false; end if;
  foreach field in array array['distanceMeters','movingTimeSeconds','elapsedTimeSeconds','averagePaceSecondsPerKm','averageSpeedMps','maxSpeedMps','averageHeartrate','maxHeartrate','elevationGainMeters','calories','averageCadence'] loop
    item:=p->field;
    if item='null'::jsonb and field not in ('distanceMeters','movingTimeSeconds','elapsedTimeSeconds') then continue; end if;
    if jsonb_typeof(item)<>'number' then return false; end if;
    n:=(item#>>'{}')::numeric;
    if n<0 or n>9007199254740991 or (field in ('movingTimeSeconds','elapsedTimeSeconds','averagePaceSecondsPerKm') and n<>trunc(n)) then return false; end if;
  end loop;
  if jsonb_typeof(p->'splits')<>'array' then return false; end if;
  for item in select value from jsonb_array_elements(p->'splits') loop
    if jsonb_typeof(item)<>'object' or not (item ?& array['kilometer','distanceMeters','movingSeconds','elapsedSeconds','averageSpeedMps','paceSecondsPerKm']) or item-array['kilometer','distanceMeters','movingSeconds','elapsedSeconds','averageSpeedMps','paceSecondsPerKm']<>'{}'::jsonb then return false; end if;
    foreach field in array array['kilometer','distanceMeters','movingSeconds','elapsedSeconds','averageSpeedMps','paceSecondsPerKm'] loop
      if item->field='null'::jsonb and field in ('averageSpeedMps','paceSecondsPerKm') then continue; end if;
      if jsonb_typeof(item->field)<>'number' then return false; end if;
      n:=(item->>field)::numeric;
      if n<0 or n>9007199254740991 or (field='kilometer' and n=0) or (field in ('kilometer','movingSeconds','elapsedSeconds','paceSecondsPerKm') and n<>trunc(n)) then return false; end if;
    end loop;
  end loop;
  foreach field in array array['fastestKilometer','slowestKilometer'] loop
    item:=p->field;
    if item='null'::jsonb then continue; end if;
    if jsonb_typeof(item)<>'object' or not (item ?& array['kilometer','paceSecondsPerKm']) or item-array['kilometer','paceSecondsPerKm']<>'{}'::jsonb then return false; end if;
    if jsonb_typeof(item->'kilometer')<>'number' or jsonb_typeof(item->'paceSecondsPerKm')<>'number' then return false; end if;
    n:=(item->>'kilometer')::numeric; if n<1 or n>9007199254740991 or n<>trunc(n) then return false; end if;
    n:=(item->>'paceSecondsPerKm')::numeric; if n<0 or n>9007199254740991 or n<>trunc(n) then return false; end if;
  end loop;
  item:=p->'paceTrend';
  if item<>'null'::jsonb then
    if jsonb_typeof(item)<>'object' or not (item ?& array['direction','earlyPaceSecondsPerKm','latePaceSecondsPerKm']) or item-array['direction','earlyPaceSecondsPerKm','latePaceSecondsPerKm']<>'{}'::jsonb or item->>'direction' not in ('faster','slower','even') then return false; end if;
    foreach field in array array['earlyPaceSecondsPerKm','latePaceSecondsPerKm'] loop
      if jsonb_typeof(item->field)<>'number' then return false; end if;
      n:=(item->>field)::numeric; if n<0 or n>9007199254740991 or n<>trunc(n) then return false; end if;
    end loop;
  end if;
  return true;
exception when others then return false;
end $$;
revoke all on function public.strava_valid_snapshot_v1(jsonb) from public,anon,authenticated;
grant execute on function public.strava_valid_snapshot_v1(jsonb) to service_role;
alter table public.strava_wrapped_snapshots add constraint strava_wrapped_snapshot_v1_shape
  check (status<>'ready' or version<>1 or public.strava_valid_snapshot_v1(payload)) not valid;
create function public.strava_projection_context(p_user uuid,p_generation uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'runner_id',r.id,'category_id',cat.id,'event_id',e.id,'runner_name',r.name,'bib_number',r.bib_number,
    'category_name',cat.name,'event_name',e.name,'event_date',e.event_date,'distance_km',cat.distance_km,
    'race',case when race.category_id is null then null else jsonb_build_object(
      'start_time_from',race.start_time_from,'start_time_to',race.start_time_to,
      'start_latitude',race.start_latitude,'start_longitude',race.start_longitude,
      'start_radius_m',race.start_radius_m,'allowed_sport_types',race.allowed_sport_types,
      'distance_tolerance_m',race.distance_tolerance_m) end) order by r.id),'[]'::jsonb)
  from public.strava_runner_attachments a
  join public.runner_access access on access.user_id=a.user_id and access.runner_id=a.runner_id
  join public.runners r on r.id=a.runner_id
  join public.categories cat on cat.id=r.category_id
  join public.events e on e.id=cat.event_id
  left join public.strava_race_configs race on race.category_id=cat.id
  where a.user_id=p_user and a.generation=p_generation and a.status='active';
$$;
create function public.strava_projection_context_matches(p_user uuid,p_generation uuid,p_context jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform access.runner_id from public.runner_access access
    join public.strava_runner_attachments a on a.user_id=access.user_id and a.runner_id=access.runner_id
    where a.user_id=p_user and a.generation=p_generation and a.status='active' order by access.runner_id for share of access;
  perform r.id from public.strava_runner_attachments a join public.runners r on r.id=a.runner_id
    where a.user_id=p_user and a.generation=p_generation and a.status='active' order by r.id for share of r;
  -- UPDATE locks prevent a concurrent insertion of an absent config through its category FK.
  perform cat.id from public.strava_runner_attachments a join public.runners r on r.id=a.runner_id
    join public.categories cat on cat.id=r.category_id
    where a.user_id=p_user and a.generation=p_generation and a.status='active' order by cat.id for update of cat;
  perform e.id from public.strava_runner_attachments a join public.runners r on r.id=a.runner_id
    join public.categories cat on cat.id=r.category_id join public.events e on e.id=cat.event_id
    where a.user_id=p_user and a.generation=p_generation and a.status='active' order by e.id for share of e;
  perform race.category_id from public.strava_runner_attachments a join public.runners r on r.id=a.runner_id
    join public.strava_race_configs race on race.category_id=r.category_id
    where a.user_id=p_user and a.generation=p_generation and a.status='active' order by race.category_id for share of race;
  return p_context is not null and p_context=public.strava_projection_context(p_user,p_generation);
end $$;
create function public.strava_commit_projection_refresh_fenced(p_job uuid,p_lease uuid,p_activities jsonb,p_continuation jsonb,p_discoveries jsonb,p_runner_candidates jsonb,p_context jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.strava_jobs; c public.strava_connections;
begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  select * into c from public.strava_connections where user_id=j.user_id for update;
  select * into j from public.strava_jobs where id=p_job for update;
  if j.id is null or j.kind<>'project' or j.status<>'processing' or j.lease_id is distinct from p_lease
    or j.lease_until<=now() or c.status<>'active' or c.generation<>j.generation then return false; end if;
  if not public.strava_projection_context_matches(j.user_id,j.generation,p_context) then
    return public.strava_retry_projection_attachments(p_job,p_lease);
  end if;
  return public.strava_commit_projection_refresh_job(p_job,p_lease,p_activities,p_continuation,p_discoveries,p_runner_candidates);
end $$;
create function public.strava_commit_projection_fenced(p_job uuid,p_lease uuid,p_payload jsonb,p_error text,p_context jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.strava_jobs; c public.strava_connections;
begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  select * into c from public.strava_connections where user_id=j.user_id for update;
  select * into j from public.strava_jobs where id=p_job for update;
  if j.id is null or j.kind<>'project' or j.status<>'processing' or j.lease_id is distinct from p_lease
    or j.lease_until<=now() or c.status<>'active' or c.generation<>j.generation then return false; end if;
  if not public.strava_projection_context_matches(j.user_id,j.generation,p_context) then
    return public.strava_retry_projection_attachments(p_job,p_lease);
  end if;
  return public.strava_commit_projection_job(p_job,p_lease,p_payload,p_error);
end $$;
revoke all on function public.strava_projection_context(uuid,uuid), public.strava_projection_context_matches(uuid,uuid,jsonb), public.strava_commit_projection_refresh_fenced(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb), public.strava_commit_projection_fenced(uuid,uuid,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.strava_projection_context(uuid,uuid), public.strava_commit_projection_refresh_fenced(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb), public.strava_commit_projection_fenced(uuid,uuid,jsonb,text,jsonb) to service_role;
revoke execute on function public.strava_commit_projection_job(uuid,uuid,jsonb,text), public.strava_commit_projection_refresh_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from service_role;
