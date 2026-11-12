-- A runner can detach/re-attach within one connection generation. Every queued
-- operation records the exact consent incarnation that authorized its work.
alter table public.strava_runner_attachments add column attachment_id uuid not null default gen_random_uuid();
alter table public.strava_runner_attachments add constraint strava_attachment_incarnation unique(attachment_id);
alter table public.strava_jobs add column attachment_fences jsonb not null default '{}' check(jsonb_typeof(attachment_fences)='object');

create function public.strava_capture_job_attachments() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.strava_connections where user_id=new.user_id for update;
  select coalesce(jsonb_object_agg(a.runner_id::text,a.attachment_id::text),'{}'::jsonb) into new.attachment_fences
    from public.strava_runner_attachments a
    where a.user_id=new.user_id and a.generation=new.generation
      and public.strava_runner_opted_in(a.user_id,a.generation,a.runner_id)
      and (new.kind not in ('backfill','activity') or new.payload->>'runner_id' is null
        or a.runner_id::text=new.payload->>'runner_id');
  return new;
end $$;
create trigger strava_capture_job_attachments before insert on public.strava_jobs
  for each row execute function public.strava_capture_job_attachments();
-- Existing queued work is retried with current consent. Old in-flight leases are
-- invalidated, so an earlier process cannot publish using the newly captured fence.
update public.strava_jobs j set attachment_fences=(select coalesce(jsonb_object_agg(a.runner_id::text,a.attachment_id::text),'{}'::jsonb)
  from public.strava_runner_attachments a where a.user_id=j.user_id and a.generation=j.generation
    and (j.kind not in ('backfill','activity') or j.payload->>'runner_id' is null or a.runner_id::text=j.payload->>'runner_id')),
  status=case when status='processing' then 'pending' else status end,lease_id=null,lease_until=null
where kind in ('backfill','activity','webhook');

create function public.strava_enqueue_runner_backfill(
  p_user uuid,p_generation uuid,p_runner uuid,p_attachment uuid,p_after bigint,p_before bigint
) returns boolean language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.strava_connections where user_id=p_user and generation=p_generation and status='active' for update;
  if not found then return false; end if;
  perform 1 from public.runner_access where user_id=p_user and runner_id=p_runner for key share;
  if not found then return false; end if;
  if not exists(select 1 from public.strava_runner_attachments where user_id=p_user and generation=p_generation
    and runner_id=p_runner and attachment_id=p_attachment and status='active') then return false; end if;
  if p_after is null or p_before is null or p_after<0 or p_after>=p_before then
    raise exception 'Invalid backfill window' using errcode='22023';
  end if;
  return public.strava_enqueue(p_user,p_generation,'backfill',
    'runner:'||p_runner::text||':backfill:'||p_after::text||':'||p_before::text||':1',
    jsonb_build_object('runner_id',p_runner,'after',p_after,'before',p_before,'page',1));
end $$;

create or replace function public.strava_detach_runner(p_user uuid,p_runner uuid)
returns text language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.strava_connections where user_id=p_user for update;
  perform 1 from public.runner_access where user_id=p_user and runner_id=p_runner for key share;
  if not found then return 'forbidden'; end if;
  delete from public.strava_runner_attachments where user_id=p_user and runner_id=p_runner;
  -- Keep cancelled attempts while their provider exchange is in flight. Completion
  -- must persist the returned credentials and queue revocation, not lose the grant.
  update public.strava_oauth_attempts set status='cancelled'
    where user_id=p_user and runner_id=p_runner and status in ('pending','processing');
  delete from public.strava_oauth_attempts where user_id=p_user and runner_id=p_runner and status='connected';
  delete from public.strava_jobs where user_id=p_user and payload->>'runner_id'=p_runner::text;
  delete from public.strava_activities a where a.user_id=p_user and not exists(
    select 1 from public.strava_activity_candidates c where c.user_id=a.user_id
      and c.generation=a.generation and c.activity_id=a.activity_id);
  return 'detached';
end $$;

create or replace function public.strava_confirm_runner_activity(
  p_user uuid,p_generation uuid,p_runner uuid,p_activity text
) returns text language plpgsql security invoker set search_path='' as $$
declare athlete text; detail jsonb;
begin
  select athlete_id into athlete from public.strava_connections
    where user_id=p_user and generation=p_generation and status='active' for update;
  if not found then return 'obsolete'; end if;
  perform 1 from public.runner_access where user_id=p_user and runner_id=p_runner for key share;
  if not found then return 'forbidden'; end if;
  if not public.strava_runner_opted_in(p_user,p_generation,p_runner) then return 'invalid_candidate'; end if;
  select a.activity into detail from public.strava_activity_candidates c join public.strava_activities a
    on a.user_id=c.user_id and a.generation=c.generation and a.activity_id=c.activity_id
    where c.user_id=p_user and c.generation=p_generation and c.runner_id=p_runner and c.activity_id=p_activity
      and c.match_status in ('auto_match','needs_confirmation') and jsonb_typeof(a.activity)='object'
      and a.activity->>'id'=p_activity and a.activity->>'athleteId'=athlete and a.activity->>'sportType'='Run'
    for share of c,a;
  if not found then return 'invalid_candidate'; end if;
  if exists(select 1 from public.strava_runner_activities where user_id=p_user and generation=p_generation
    and activity_id=p_activity and runner_id<>p_runner) then return 'activity_already_selected'; end if;
  return public.strava_select_runner_activity(p_user,p_generation,p_runner,p_activity,jsonb_build_object(
    'avg_heartrate',detail->'averageHeartrate','max_heartrate',detail->'maxHeartrate',
    'elevation_gain_m',detail->'elevationGainMeters','calories',detail->'calories','avg_cadence',detail->'averageCadence'));
end $$;

create or replace function public.strava_commit_runner_job(
  p_job uuid,p_lease uuid,p_activities jsonb default '[]',p_continuation jsonb default null,
  p_discoveries jsonb default '[]',p_runner_candidates jsonb default '[]'
) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.strava_jobs; connection public.strava_connections; fences jsonb; batch jsonb; item jsonb;
  runner uuid; prior jsonb; chosen text; provenance text; qualifying bigint; candidate text; candidate_status text;
  detail jsonb; writes jsonb:='[]'; discovery_complete boolean; scoped boolean;
begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  select * into connection from public.strava_connections where user_id=j.user_id for update;
  select * into j from public.strava_jobs where id=p_job for update;
  if j.id is null or j.lease_id is distinct from p_lease or j.lease_until<=now() or j.status<>'processing'
    or j.generation<>connection.generation then return false; end if;
  if connection.status<>'active' then return public.strava_commit_job(p_job,p_lease); end if;
  scoped:=j.kind in ('backfill','activity') and j.payload->>'runner_id' is not null;
  select coalesce(jsonb_object_agg(a.runner_id::text,a.attachment_id::text),'{}'::jsonb) into fences
    from public.strava_runner_attachments a where a.user_id=j.user_id and a.generation=j.generation
      and public.strava_runner_opted_in(a.user_id,a.generation,a.runner_id)
      and (not scoped or a.runner_id::text=j.payload->>'runner_id');
  -- Suppress the entire stale shared response: replacing its raw activity could
  -- otherwise cascade through a newly created attachment's selection/snapshot.
  if fences is distinct from j.attachment_fences or fences='{}'::jsonb then
    return public.strava_commit_job(p_job,p_lease);
  end if;
  for batch in select value from jsonb_array_elements(p_runner_candidates) loop
    if not (fences ? (batch->>'runner_id')) or not public.strava_runner_opted_in(j.user_id,j.generation,(batch->>'runner_id')::uuid) then
      raise exception 'Runner opt-in required' using errcode='42501';
    end if;
  end loop;
  if scoped and j.kind='backfill' then
    if p_continuation is not null and p_continuation->'payload'->>'runner_id' is distinct from j.payload->>'runner_id' then
      raise exception 'Invalid continuation scope' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_array_elements(p_discoveries) d where d->>'runner_id' is distinct from j.payload->>'runner_id') then
      raise exception 'Invalid discovery scope' using errcode='22023';
    end if;
  end if;
  select coalesce(jsonb_object_agg(runner_id::text,jsonb_build_object('activity',activity_id,'source',selection_source)),'{}'::jsonb)
    into prior from public.strava_runner_activities where user_id=j.user_id and generation=j.generation;
  for item in select value from jsonb_array_elements(p_activities) loop
    -- Discovery reuses the stored detail. Only a shared provider event refreshes
    -- it and reclassifies every attached registration affected by that refresh.
    if scoped and exists(select 1 from public.strava_activities where user_id=j.user_id and generation=j.generation and activity_id=item->>'id') then continue; end if;
    if item->'activity' is null or item->'activity'='null'::jsonb then
      writes:=writes||jsonb_build_array(item);
    elsif exists(select 1 from jsonb_array_elements(p_runner_candidates) b,
      jsonb_array_elements(b->'candidates') c where c->>'activity_id'=item->>'id' and c->>'match_status' in ('auto_match','needs_confirmation')) then
      writes:=writes||jsonb_build_array(item);
    elsif not scoped then
      writes:=writes||jsonb_build_array(jsonb_build_object('id',item->>'id','activity',null));
    end if;
  end loop;
  if not public.strava_commit_job(p_job,p_lease,writes,p_continuation=>p_continuation,p_discoveries=>p_discoveries) then return false; end if;
  delete from public.strava_activities where user_id=j.user_id and generation=j.generation and activity is null;
  for batch in select value from jsonb_array_elements(p_runner_candidates) loop
    for item in select value from jsonb_array_elements(batch->'candidates') loop
      if item->>'match_status'='no_match' then
        delete from public.strava_activity_candidates where user_id=j.user_id and generation=j.generation
          and runner_id=(batch->>'runner_id')::uuid and activity_id=item->>'activity_id';
      else
        perform public.strava_store_runner_candidates(j.user_id,j.generation,(batch->>'runner_id')::uuid,jsonb_build_array(item));
      end if;
    end loop;
  end loop;
  -- Restore prior qualifying choices before considering new overlapping candidates.
  for runner in select key::uuid from jsonb_each(fences) order by (prior ? key) desc,key loop
    chosen:=prior->runner::text->>'activity'; provenance:=prior->runner::text->>'source';
    select count(*),min(activity_id),min(c.match_status) into qualifying,candidate,candidate_status
      from public.strava_activity_candidates c where c.user_id=j.user_id and c.generation=j.generation and c.runner_id=runner
        and c.match_status in ('auto_match','needs_confirmation');
    if chosen is not null and (provenance='manual' or qualifying=1) and exists(
      select 1 from public.strava_activity_candidates where user_id=j.user_id and generation=j.generation and runner_id=runner
        and activity_id=chosen and match_status in ('auto_match','needs_confirmation')) then
      if exists(select 1 from public.strava_runner_activities where runner_id=runner and user_id=j.user_id and generation=j.generation and activity_id=chosen) then continue; end if;
      candidate:=chosen;
    else
      chosen:=null; provenance:='auto';
    end if;
    discovery_complete:=not exists(select 1 from public.strava_jobs where user_id=j.user_id and generation=j.generation
      and kind in ('backfill','activity','webhook') and status<>'complete'
      and (kind='webhook' or payload->>'runner_id' is null or payload->>'runner_id'=runner::text));
    if (chosen is not null or (discovery_complete and qualifying=1 and candidate_status='auto_match'
        and not exists(select 1 from public.strava_activity_candidates where user_id=j.user_id and generation=j.generation
          and activity_id=candidate and runner_id<>runner)))
      and not exists(select 1 from public.strava_runner_activities where user_id=j.user_id and generation=j.generation and activity_id=candidate and runner_id<>runner) then
      select activity into detail from public.strava_activities where user_id=j.user_id and generation=j.generation and activity_id=candidate;
      perform public.strava_select_runner_activity(j.user_id,j.generation,runner,candidate,jsonb_build_object(
        'avg_heartrate',detail->'averageHeartrate','max_heartrate',detail->'maxHeartrate','elevation_gain_m',detail->'elevationGainMeters',
        'calories',detail->'calories','avg_cadence',detail->'averageCadence'));
      update public.strava_runner_activities set selection_source=provenance where user_id=j.user_id and generation=j.generation and runner_id=runner;
    else
      delete from public.strava_runner_activities where user_id=j.user_id and generation=j.generation and runner_id=runner;
    end if;
  end loop;
  delete from public.strava_activities a where a.user_id=j.user_id and a.generation=j.generation
    and not exists(select 1 from public.strava_activity_candidates c where c.user_id=a.user_id and c.generation=a.generation and c.activity_id=a.activity_id);
  return true;
end $$;

revoke all on function public.strava_capture_job_attachments(),public.strava_enqueue_runner_backfill(uuid,uuid,uuid,uuid,bigint,bigint),
  public.strava_detach_runner(uuid,uuid),public.strava_confirm_runner_activity(uuid,uuid,uuid,text),
  public.strava_commit_runner_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.strava_capture_job_attachments(),public.strava_enqueue_runner_backfill(uuid,uuid,uuid,uuid,bigint,bigint),
  public.strava_detach_runner(uuid,uuid),public.strava_confirm_runner_activity(uuid,uuid,uuid,text),
  public.strava_commit_runner_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
