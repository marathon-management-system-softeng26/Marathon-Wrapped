-- Retry stale provider events and preserve only valid selection provenance.
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
    -- Preserve the original deduplication key and payload. A shared provider
    -- event must be fetched again under the current consent set; never publish
    -- the old response into a replacement attachment. Claims remain bounded by
    -- the existing eight-attempt limit and exhausted work is visibly failed.
    if j.kind='webhook' and fences<>'{}'::jsonb then
      update public.strava_jobs set attachment_fences=fences,
        status=case when attempts>=8 then 'failed' else 'pending' end,
        available_at=now(),last_error='attachment_changed',lease_id=null,lease_until=null
        where id=j.id;
      return true;
    end if;
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
        and activity_id=chosen and (match_status='auto_match' or
          (provenance='manual' and match_status='needs_confirmation'))) then
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

