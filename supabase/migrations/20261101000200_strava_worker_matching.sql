-- Keep the original lifecycle RPC intact. This wrapper makes its successful commit
-- and race matching one transaction, under the same per-connection lock.
alter table public.strava_runner_activities add column selection_source text not null default 'manual'
  check (selection_source in ('auto','manual'));

-- The existing selection RPC represents explicit confirmation. Its INSERT/UPSERT
-- resets provenance even when the same automatically selected activity is confirmed.
create function public.strava_mark_manual_selection() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.selection_source := 'manual';
  return new;
end $$;
create trigger strava_mark_manual_selection before insert or update of activity_id,selected_at
  on public.strava_runner_activities for each row execute function public.strava_mark_manual_selection();
revoke all on function public.strava_mark_manual_selection() from public,anon,authenticated;
grant execute on function public.strava_mark_manual_selection() to service_role;

create function public.strava_commit_runner_job(
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
begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  perform 1 from public.strava_connections where user_id=j.user_id for update;
  select jsonb_object_agg(runner_id::text,activity_id) into manual_choices
    from public.strava_runner_activities where user_id=j.user_id and generation=j.generation and selection_source='manual';
  if not public.strava_commit_job(p_job,p_lease,p_activities,
    p_continuation=>p_continuation,p_discoveries=>p_discoveries) then return false; end if;
  if not exists(select 1 from public.strava_connections
    where user_id=j.user_id and generation=j.generation and status='active') then return true; end if;

  for batch in select value from jsonb_array_elements(p_runner_candidates) loop
    perform public.strava_store_runner_candidates(j.user_id,j.generation,
      (batch->>'runner_id')::uuid,batch->'candidates');
  end loop;

  -- All runners share the athlete discovery queue. Be conservative if any page or
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
