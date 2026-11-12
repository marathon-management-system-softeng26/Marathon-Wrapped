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
                    and (j.status='pending' or (j.status='processing' and j.lease_id is not null and j.lease_until is not null))))))
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

create or replace function public.strava_valid_snapshot_v1(p jsonb) returns boolean
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
    if jsonb_typeof(item)<>'object' or not (item ?& array['direction','earlyPaceSecondsPerKm','latePaceSecondsPerKm']) or item-array['direction','earlyPaceSecondsPerKm','latePaceSecondsPerKm']<>'{}'::jsonb or jsonb_typeof(item->'direction')<>'string' or item->>'direction' not in ('faster','slower','even') then return false; end if;
    foreach field in array array['earlyPaceSecondsPerKm','latePaceSecondsPerKm'] loop
      if jsonb_typeof(item->field)<>'number' then return false; end if;
      n:=(item->>field)::numeric; if n<0 or n>9007199254740991 or n<>trunc(n) then return false; end if;
    end loop;
  end if;
  return true;
exception when others then return false;
end $$;
create or replace function public.strava_projection_context_matches(p_user uuid,p_generation uuid,p_context jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  -- Lock exactly the IDs supplied by the coherent read, parents before children.
  -- A concurrent move or deletion is detected by the final context comparison.
  if jsonb_typeof(p_context)<>'array' then return false; end if;
  perform e.id from public.events e where e.id in
    (select (x->>'event_id')::bigint from jsonb_array_elements(p_context) x) order by e.id for share;
  perform cat.id from public.categories cat where cat.id in
    (select (x->>'category_id')::bigint from jsonb_array_elements(p_context) x) order by cat.id for update;
  perform r.id from public.runners r where r.id in
    (select (x->>'runner_id')::uuid from jsonb_array_elements(p_context) x) order by r.id for share;
  perform access.runner_id from public.runner_access access where access.user_id=p_user and access.runner_id in
    (select (x->>'runner_id')::uuid from jsonb_array_elements(p_context) x) order by access.runner_id for share;
  perform race.category_id from public.strava_race_configs race where race.category_id in
    (select (x->>'category_id')::bigint from jsonb_array_elements(p_context) x) order by race.category_id for share;
  return p_context is not null and p_context=public.strava_projection_context(p_user,p_generation);
end $$;
alter function public.strava_commit_job(uuid,uuid,jsonb,text,integer,boolean,jsonb,jsonb) rename to strava_commit_job_internal;
revoke all on function public.strava_commit_job_internal(uuid,uuid,jsonb,text,integer,boolean,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.strava_commit_job(p_job uuid,p_lease uuid,p_activities jsonb default '[]',p_error text default null,p_delay integer default null,p_reauth boolean default false,p_continuation jsonb default null,p_discoveries jsonb default '[]')
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.strava_jobs; c public.strava_connections;
begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  select * into c from public.strava_connections where user_id=j.user_id for update;
  select * into j from public.strava_jobs where id=p_job for update;
  if j.kind='project' then
    if j.status<>'processing' or j.lease_id is distinct from p_lease or j.lease_until is null or j.lease_until<=now() or j.generation<>c.generation then return false; end if;
    update public.strava_jobs set status='pending',lease_id=null,lease_until=null,available_at=now() where id=j.id;
    return true;
  end if;
  return public.strava_commit_job_internal(p_job,p_lease,p_activities,p_error,p_delay,p_reauth,p_continuation,p_discoveries);
end $$;
revoke all on function public.strava_commit_job(uuid,uuid,jsonb,text,integer,boolean,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.strava_commit_job(uuid,uuid,jsonb,text,integer,boolean,jsonb,jsonb) to service_role;
-- Only fenced projection paths and their private runner implementation may use
-- the original generic commit semantics for a project job.
do $$
declare definition text; signature text;
begin
  definition:=pg_get_functiondef('public.strava_commit_runner_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
  execute replace(definition,'public.strava_commit_runner_job(', 'public.strava_commit_projection_runner_internal(');
  foreach signature in array array[
    'public.strava_commit_runner_job_before_projection(uuid,uuid,jsonb,jsonb,jsonb,jsonb)',
    'public.strava_retry_projection_attachments(uuid,uuid)',
    'public.strava_commit_projection_job(uuid,uuid,jsonb,text)',
    'public.strava_commit_projection_refresh_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb)',
    'public.strava_fail_projection_job(uuid,uuid,text,integer,boolean)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    definition:=replace(definition,'public.strava_commit_job(', 'public.strava_commit_job_internal(');
    if signature like '%strava_commit_projection_refresh_job%' then
      definition:=replace(definition,'public.strava_commit_runner_job(', 'public.strava_commit_projection_runner_internal(');
    end if;
    execute definition;
  end loop;
end $$;
revoke all on function public.strava_commit_projection_runner_internal(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
-- Intercept legacy runner completion before it can process a project as webhook.
create or replace function public.strava_commit_runner_job(p_job uuid,p_lease uuid,p_activities jsonb default '[]',p_continuation jsonb default null,p_discoveries jsonb default '[]',p_runner_candidates jsonb default '[]')
returns boolean language plpgsql security definer set search_path='' as $$
declare kind text;
begin
  select j.kind into kind from public.strava_jobs j where j.id=p_job;
  if kind='project' then return public.strava_commit_job(p_job,p_lease); end if;
  return public.strava_commit_projection_runner_internal(p_job,p_lease,p_activities,p_continuation,p_discoveries,p_runner_candidates);
end $$;
select public.strava_backfill_selected_projections();
create function public.strava_project_lease_current(p_job uuid,p_lease uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.strava_jobs j join public.strava_connections c on c.user_id=j.user_id
    join public.strava_runner_activities s on s.user_id=j.user_id and s.generation=j.generation
      and s.runner_id::text=j.payload->>'runner_id' and s.activity_id=j.payload->>'activity_id'
    join public.strava_wrapped_snapshots w on w.user_id=s.user_id and w.generation=s.generation and w.runner_id=s.runner_id and w.activity_id=s.activity_id
      and w.version::text=j.payload->>'version' and w.build_id::text=j.payload->>'build_id' and w.status='building'
    join public.strava_runner_attachments a on a.user_id=s.user_id and a.generation=s.generation and a.runner_id=s.runner_id and a.status='active'
    where j.id=p_job and j.user_id=p_user and j.kind='project' and j.status='processing' and j.lease_id=p_lease and j.lease_until>now()
      and c.status='active' and c.generation=j.generation and a.attachment_id::text=j.attachment_fences->>s.runner_id::text
      and public.strava_runner_opted_in(j.user_id,j.generation,s.runner_id));
$$;
create function public.strava_claim_project_credentials(p_user uuid,p_kind text,p_job uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.strava_connections where user_id=p_user for update;
  perform 1 from public.strava_jobs where id=p_job for update;
  if not public.strava_project_lease_current(p_job,p_lease,p_user) then return null; end if;
  return public.strava_claim_credentials(p_user,p_kind);
end $$;
create function public.strava_finish_project_refresh(p_user uuid,p_operation uuid,p_generation uuid,p_tokens jsonb default null,p_reauth boolean default false,p_uncertain boolean default false,p_job uuid default null,p_lease uuid default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare current_build boolean; finished boolean; c public.strava_connections;
begin
  select * into c from public.strava_connections where user_id=p_user for update;
  perform 1 from public.strava_jobs where id=p_job for update;
  if c.operation_id is distinct from p_operation or c.operation_kind<>'refresh' then return false; end if;
  current_build:=public.strava_project_lease_current(p_job,p_lease,p_user);
  -- This exact credential operation owns a potentially rotated token even when
  -- the requesting build has since been replaced. Preserve its token/uncertain
  -- result, but do not propagate reauthorization from a stale project.
  finished:=public.strava_finish_refresh(p_user,p_operation,p_generation,p_tokens,p_reauth and current_build,p_uncertain);
  return finished and current_build;
end $$;
revoke all on function public.strava_project_lease_current(uuid,uuid,uuid), public.strava_claim_project_credentials(uuid,text,uuid,uuid), public.strava_finish_project_refresh(uuid,uuid,uuid,jsonb,boolean,boolean,uuid,uuid) from public,anon,authenticated;
grant execute on function public.strava_claim_project_credentials(uuid,text,uuid,uuid), public.strava_finish_project_refresh(uuid,uuid,uuid,jsonb,boolean,boolean,uuid,uuid) to service_role;

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
    return public.strava_commit_job_internal(p_job,p_lease);
  end if;
  if p_error='authorization_revoked' and public.strava_provider_revoked(j.user_id,j.generation) then return true; end if;
  if incarnation is not distinct from j.attachment_fences->>(j.payload->>'runner_id') and incarnation is not null
    and (p_delay is null or j.attempts>=8) then
    perform public.strava_finish_wrapped_snapshot(j.user_id,j.generation,(j.payload->>'runner_id')::uuid,
      j.payload->>'activity_id',(j.payload->>'version')::integer,(j.payload->>'build_id')::uuid,'failed',null,p_error);
  end if;
  return public.strava_commit_job_internal(p_job,p_lease,p_error=>p_error,p_delay=>p_delay,p_reauth=>p_reauth);
end $$;

create function public.strava_discard_projection_job(p_job uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.strava_jobs;
begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  perform 1 from public.strava_connections where user_id=j.user_id for update;
  select * into j from public.strava_jobs where id=p_job for update;
  if j.kind<>'project' or j.status<>'processing' or j.lease_id is distinct from p_lease or j.lease_until is null or j.lease_until<=now() then return false; end if;
  if public.strava_project_lease_current(p_job,p_lease,j.user_id) then
    return public.strava_fail_projection_job(p_job,p_lease,'invalid_projection',null,false);
  end if;
  return public.strava_commit_job_internal(p_job,p_lease);
end $$;
revoke all on function public.strava_discard_projection_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.strava_discard_projection_job(uuid,uuid) to service_role;
-- A NULL lease is never an authorized project completion.
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.strava_retry_projection_attachments(uuid,uuid)',
    'public.strava_commit_projection_job(uuid,uuid,jsonb,text)',
    'public.strava_commit_projection_refresh_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb)',
    'public.strava_fail_projection_job(uuid,uuid,text,integer,boolean)',
    'public.strava_commit_projection_fenced(uuid,uuid,jsonb,text,jsonb)',
    'public.strava_commit_projection_refresh_fenced(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    execute replace(definition,'or j.lease_until<=now()', 'or p_lease is null or j.lease_until is null or j.lease_until<=now()');
  end loop;
end $$;
