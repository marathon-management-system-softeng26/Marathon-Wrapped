-- Completed runner-bound OAuth attempts are the durable opt-in for a generation.
-- They outlive their callback expiry; only a subsequent authorization prunes them.
create function public.strava_runner_opted_in(p_user uuid,p_generation uuid,p_runner uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.strava_connections c
    join public.strava_oauth_attempts a on a.user_id=c.user_id and a.generation=c.generation
    join public.runner_access r on r.user_id=a.user_id and r.runner_id=a.runner_id
    where c.user_id=p_user and c.generation=p_generation and c.status='active'
      and a.status='connected' and a.runner_id=p_runner)
$$;
revoke all on function public.strava_runner_opted_in(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.strava_runner_opted_in(uuid,uuid,uuid) to service_role;

-- Remove pre-fix fan-out and unrelated private snapshots, including legacy links
-- that have no runner opt-in. Demo data and provider credentials are untouched.
delete from public.strava_activity_candidates c
  where not public.strava_runner_opted_in(c.user_id,c.generation,c.runner_id) or c.match_status='no_match';
delete from public.strava_activities a where not exists(
  select 1 from public.strava_activity_candidates c where c.user_id=a.user_id
    and c.generation=a.generation and c.activity_id=a.activity_id);

create function public.strava_require_runner_opt_in() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.strava_connections where user_id=new.user_id for update;
  if not public.strava_runner_opted_in(new.user_id,new.generation,new.runner_id) then
    raise exception 'Runner opt-in required' using errcode='42501';
  end if;
  return new;
end $$;
create trigger strava_candidate_opt_in before insert or update on public.strava_activity_candidates
  for each row execute function public.strava_require_runner_opt_in();
create trigger strava_selection_opt_in before insert or update on public.strava_runner_activities
  for each row execute function public.strava_require_runner_opt_in();
revoke all on function public.strava_require_runner_opt_in() from public,anon,authenticated;
grant execute on function public.strava_require_runner_opt_in() to service_role;

-- Explicit Connect can bind an older unscoped active grant without asking the
-- provider again. An existing runner scope cannot be silently transferred.
create or replace function public.strava_begin_runner_oauth(p_user uuid,p_runner uuid,p_hash text,p_return_path text)
returns text language plpgsql security invoker set search_path='' as $$
declare result text; c public.strava_connections;
begin
  if p_return_path is distinct from '/wrapped/'||p_runner::text or p_hash is null or length(p_hash)=0 then
    raise exception 'Invalid runner OAuth context' using errcode='22023';
  end if;
  -- Keep connection -> access lock ordering consistent with worker and selection.
  select * into c from public.strava_connections where user_id=p_user for update;
  perform 1 from public.runner_access where user_id=p_user and runner_id=p_runner for key share;
  if not found then raise exception 'Runner access required' using errcode='42501'; end if;
  result := public.strava_begin_oauth(p_user,p_hash);
  if result='ready' then
    update public.strava_oauth_attempts set runner_id=p_runner,return_path=p_return_path where user_id=p_user and state_hash=p_hash;
  elsif result='already_connected' then
    if exists(select 1 from public.strava_oauth_attempts a where a.user_id=p_user
      and a.generation=c.generation and a.status='connected' and a.runner_id is not null and a.runner_id<>p_runner) then
      return 'different_runner';
    end if;
    if not public.strava_runner_opted_in(p_user,c.generation,p_runner) then
      -- Old pre-runner attempts are not valid runner opt-ins.
      delete from public.strava_oauth_attempts where user_id=p_user and generation=c.generation and status='connected' and runner_id is null;
      insert into public.strava_oauth_attempts(state_hash,user_id,generation,status,runner_id,return_path)
        values(p_hash,p_user,c.generation,'connected',p_runner,p_return_path);
    end if;
  end if;
  return result;
end $$;

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
  scoped_runner uuid;
begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  select * into locked_connection from public.strava_connections where user_id=j.user_id for update;
  select * into j from public.strava_jobs where id=p_job for update;
  if j.id is null or j.lease_id is distinct from p_lease or j.lease_until<=now()
    or j.status<>'processing' or j.generation<>locked_connection.generation then return false; end if;
  select a.runner_id into scoped_runner from public.strava_oauth_attempts a
    where a.user_id=j.user_id and a.generation=j.generation and a.status='connected'
      and public.strava_runner_opted_in(j.user_id,j.generation,a.runner_id);
  for batch in select value from jsonb_array_elements(p_runner_candidates) loop
    if not public.strava_runner_opted_in(j.user_id,j.generation,(batch->>'runner_id')::uuid) then
      raise exception 'Runner opt-in required' using errcode='42501';
    end if;
  end loop;
  if scoped_runner is null or (j.kind='backfill' and j.payload->>'runner_id' is distinct from scoped_runner::text) then
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

  -- The scoped runner uses the athlete discovery queue. Be conservative if any page or
  -- detail is unfinished (including permanently failed imports with unknown data).
  discovery_complete := not exists(select 1 from public.strava_jobs where user_id=j.user_id and generation=j.generation
    and kind in ('backfill','activity','webhook') and status<>'complete');

  for runner in select distinct runner_id from public.strava_activity_candidates
    where user_id=j.user_id and generation=j.generation loop
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
    if manual_candidate is not null or (discovery_complete and qualifying=1 and match_status='auto_match') then
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
