-- Runner confirmation accepts identity only. Derive metrics after taking the same
-- connection lock as worker commits, then hold the candidate/detail snapshot
-- through the existing atomic selection RPC. The worker's API stays unchanged.
create function public.strava_confirm_runner_activity(
  p_user uuid, p_generation uuid, p_runner uuid, p_activity text
) returns text language plpgsql security invoker set search_path = '' as $$
declare
  athlete text;
  detail jsonb;
begin
  select athlete_id into athlete from public.strava_connections
    where user_id=p_user and generation=p_generation and status='active' for update;
  if not found then return 'obsolete'; end if;
  perform 1 from public.runner_access where user_id=p_user and runner_id=p_runner for key share;
  if not found then return 'forbidden'; end if;
  select a.activity into detail
    from public.strava_activity_candidates c join public.strava_activities a
      on a.user_id=c.user_id and a.generation=c.generation and a.activity_id=c.activity_id
    where c.user_id=p_user and c.generation=p_generation and c.runner_id=p_runner and c.activity_id=p_activity
      and c.match_status in ('auto_match','needs_confirmation') and jsonb_typeof(a.activity)='object'
      and a.activity->>'id'=p_activity and a.activity->>'athleteId'=athlete and a.activity->>'sportType'='Run'
    for share of c,a;
  if not found then return 'invalid_candidate'; end if;
  return public.strava_select_runner_activity(p_user,p_generation,p_runner,p_activity,jsonb_build_object(
    'avg_heartrate',detail->'averageHeartrate','max_heartrate',detail->'maxHeartrate',
    'elevation_gain_m',detail->'elevationGainMeters','calories',detail->'calories',
    'avg_cadence',detail->'averageCadence'));
end $$;

revoke all on function public.strava_confirm_runner_activity(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.strava_confirm_runner_activity(uuid,uuid,uuid,text) to service_role;
