-- Reuse one verified athlete connection while consent remains per registration.
create or replace function public.strava_begin_runner_oauth(p_user uuid,p_runner uuid,p_hash text,p_return_path text)
returns text language plpgsql security invoker set search_path='' as $$
declare result text;
begin
  if p_return_path is distinct from '/wrapped/'||p_runner::text or p_hash is null or length(p_hash)=0 then
    raise exception 'Invalid runner OAuth context' using errcode='22023';
  end if;
  perform 1 from public.strava_connections where user_id=p_user for update;
  perform 1 from public.runner_access where user_id=p_user and runner_id=p_runner for key share;
  if not found then raise exception 'Runner access required' using errcode='42501'; end if;
  result := public.strava_begin_oauth(p_user,p_hash);
  if result='ready' then
    update public.strava_oauth_attempts set runner_id=p_runner,return_path=p_return_path where user_id=p_user and state_hash=p_hash;
  elsif result='already_connected' then
    perform public.strava_attach_runner(p_user,p_runner);
  end if;
  return result;
end $$;
revoke all on function public.strava_begin_runner_oauth(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.strava_begin_runner_oauth(uuid,uuid,text,text) to service_role;

create or replace function public.strava_commit_runner_job(
  p_job uuid,
  p_lease uuid,
  p_activities jsonb default '[]',
  p_continuation jsonb default null,
  p_discoveries jsonb default '[]',
  p_runner_candidates jsonb default '[]'
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  j public.strava_jobs;
  batch jsonb;
  runner uuid;
  qualifying bigint;
  candidate text;
  match_status text;
  detail jsonb;
  discovery_complete boolean;
  manual_choices jsonb;
  manual_candidate text;
  locked_connection public.strava_connections;
  item jsonb;

begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  select * into locked_connection from public.strava_connections where user_id=j.user_id for update;
  select * into j from public.strava_jobs where id=p_job for update;
  if j.id is null or j.lease_id is distinct from p_lease or j.lease_until<=now()
    or j.status<>'processing' or j.generation<>locked_connection.generation then return false; end if;
  -- Each batch must still have direct ownership and explicit current consent.
  for batch in select value from jsonb_array_elements(p_runner_candidates) loop
    if not public.strava_runner_opted_in(j.user_id,j.generation,(batch->>'runner_id')::uuid) then
      raise exception 'Runner opt-in required' using errcode='42501';
    end if;
  end loop;
  if j.kind='backfill' and not exists(select 1 from public.strava_runner_attachments a
    where a.user_id=j.user_id and a.generation=j.generation and a.runner_id::text=j.payload->>'runner_id'
      and public.strava_runner_opted_in(a.user_id,a.generation,a.runner_id)) then
    p_continuation := null;
    p_discoveries := '[]';
  end if;
  -- Retain a detail only when this commit classifies it inside the opted-in race.
  select coalesce(jsonb_agg(jsonb_build_object('id',v->>'id','activity',
    case when exists(select 1 from jsonb_array_elements(p_runner_candidates) b,
      jsonb_array_elements(b->'candidates') proposed
      where proposed->>'activity_id'=v->>'id' and proposed->>'match_status' in ('auto_match','needs_confirmation'))
      then v->'activity' else 'null'::jsonb end)), '[]'::jsonb)
    into p_activities from jsonb_array_elements(p_activities) v;
  select jsonb_object_agg(runner_id::text,activity_id) into manual_choices
    from public.strava_runner_activities where user_id=j.user_id and generation=j.generation and selection_source='manual';
  if not public.strava_commit_job(p_job,p_lease,p_activities,
    p_continuation=>p_continuation,p_discoveries=>p_discoveries) then return false; end if;
  if not exists(select 1 from public.strava_connections
    where user_id=j.user_id and generation=j.generation and status='active') then return true; end if;

  -- Null snapshots invalidate an old selection but never accumulate tombstones.
  delete from public.strava_activities where user_id=j.user_id and generation=j.generation and activity is null;
  for batch in select value from jsonb_array_elements(p_runner_candidates) loop
    for item in select value from jsonb_array_elements(batch->'candidates') loop
      if item->>'match_status'='no_match' then
        delete from public.strava_activities where user_id=j.user_id and generation=j.generation and activity_id=item->>'activity_id';
      end if;
    end loop;
    select coalesce(jsonb_agg(value), '[]'::jsonb) into detail
      from jsonb_array_elements(batch->'candidates') where value->>'match_status' in ('auto_match','needs_confirmation');
    batch := jsonb_set(batch,'{candidates}',detail);
    perform public.strava_store_runner_candidates(j.user_id,j.generation,
      (batch->>'runner_id')::uuid,batch->'candidates');
  end loop;

  for runner in select distinct runner_id from public.strava_activity_candidates
    where user_id=j.user_id and generation=j.generation order by runner_id loop
    -- Only this runner's discovery and shared webhooks block automatic selection.
    discovery_complete := not exists(select 1 from public.strava_jobs where user_id=j.user_id and generation=j.generation
      and kind in ('backfill','activity','webhook') and status<>'complete'
      and (kind='webhook' or payload->>'runner_id' is null or payload->>'runner_id'=runner::text));
    if exists(select 1 from public.strava_runner_activities where user_id=j.user_id
      and generation=j.generation and runner_id=runner and selection_source='manual') then continue; end if;
    select count(*),min(activity_id),min(c.match_status) into qualifying,candidate,match_status
      from public.strava_activity_candidates c
      where c.user_id=j.user_id and c.generation=j.generation and c.runner_id=runner
        and c.match_status in ('auto_match','needs_confirmation');
    -- Snapshot replacement clears candidate dependants. Restore a prior explicit
    -- choice only if the refreshed detail is still a qualifying candidate.
    manual_candidate := manual_choices->>runner::text;
    if manual_candidate is not null and exists(select 1 from public.strava_activity_candidates c
      where c.user_id=j.user_id and c.generation=j.generation and c.runner_id=runner
        and c.activity_id=manual_candidate and c.match_status in ('auto_match','needs_confirmation')) then
      candidate := manual_candidate;
    else
      manual_candidate := null;
    end if;
    if (manual_candidate is not null or (discovery_complete and qualifying=1 and match_status='auto_match'
      and not exists(select 1 from public.strava_activity_candidates c where c.user_id=j.user_id
        and c.generation=j.generation and c.activity_id=candidate and c.runner_id<>runner)))
      and not exists(select 1 from public.strava_runner_activities s where s.user_id=j.user_id
        and s.generation=j.generation and s.activity_id=candidate and s.runner_id<>runner) then
      select activity into detail from public.strava_activities
        where user_id=j.user_id and generation=j.generation and activity_id=candidate;
      perform public.strava_select_runner_activity(j.user_id,j.generation,runner,candidate,jsonb_build_object(
        'avg_heartrate',detail->'averageHeartrate','max_heartrate',detail->'maxHeartrate',
        'elevation_gain_m',detail->'elevationGainMeters','calories',detail->'calories',
        'avg_cadence',detail->'averageCadence'));
      update public.strava_runner_activities set selection_source=case when manual_candidate is null then 'auto' else 'manual' end
        where user_id=j.user_id and generation=j.generation and runner_id=runner and activity_id=candidate;
    else
      delete from public.strava_runner_activities
        where user_id=j.user_id and generation=j.generation and runner_id=runner;
    end if;
  end loop;
  return true;
end $$;

revoke all on function public.strava_commit_runner_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.strava_commit_runner_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
