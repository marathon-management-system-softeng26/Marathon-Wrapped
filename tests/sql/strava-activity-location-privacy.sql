create temporary table activity_location_fixture (data jsonb);

do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid;
  a uuid:=(f->>'a')::uuid; g uuid:=(f->>'g')::uuid; build uuid;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values
    (u,g,'10','{"id":"10","athleteId":"900","sportType":"Run","startLatLng":[-6.2,106.8],"averageHeartrate":150}'),
    (u,g,'12','{"id":"12","athleteId":"900","sportType":"Run","startLatLng":null}');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  assert public.strava_confirm_runner_activity(u,g,a,'10')='selected';
  build:=public.strava_begin_wrapped_snapshot(u,g,a,'10',1);
  assert public.strava_finish_wrapped_snapshot(u,g,a,'10',1,build,'ready','{"version":1}')='ready';
  insert into activity_location_fixture values (f||jsonb_build_object('build',build));
end $$;

-- AFTER MIGRATION

do $$
declare f jsonb:=(select data from activity_location_fixture); u uuid:=(f->>'u')::uuid;
  a uuid:=(f->>'a')::uuid; b uuid:=(f->>'b')::uuid; g uuid:=(f->>'g')::uuid; j jsonb;
begin
  assert (select activity='{"id":"10","athleteId":"900","sportType":"Run","gpsAvailable":true,"averageHeartrate":150}'
    from public.strava_activities where user_id=u and activity_id='10'), 'legacy exact GPS survived the migration';
  assert (select activity->'gpsAvailable'='false'::jsonb and not activity ? 'startLatLng'
    from public.strava_activities where user_id=u and activity_id='12'), 'legacy missing GPS was not preserved as false';
  assert exists(select 1 from public.strava_runner_activities where runner_id=a and activity_id='10' and selection_source='manual'),
    'privacy scrub invalidated the existing selection';
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and build_id=(f->>'build')::uuid
    and status='ready' and payload='{"version":1}'), 'privacy scrub invalidated the existing snapshot';

  perform public.strava_enqueue(u,g,'activity','older-worker-location',jsonb_build_object('runner_id',b));
  j:=public.strava_claim_job();
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    '[{"id":"11","activity":{"id":"11","athleteId":"900","sportType":"Run","startLatLng":[-6.2,106.8],"map":{"polyline":"private"}}}]',
    p_runner_candidates=>jsonb_build_array(pg_temp.fence_batch(b,'11')));
  assert (select activity='{"id":"11","athleteId":"900","sportType":"Run","gpsAvailable":true}'
    from public.strava_activities where user_id=u and activity_id='11'), 'older worker persisted exact GPS or route data';

  begin
    insert into public.strava_activities(user_id,generation,activity_id,activity)
      values(u,g,'13','{"id":"13","gpsAvailable":"true"}');
    raise exception 'non-boolean GPS presence was persisted';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.strava_activities(user_id,generation,activity_id,activity)
      values(u,g,'14','{"id":"14","metricSplits":[{"coordinates":[-6.2,106.8]}]}');
    raise exception 'nested exact GPS was persisted';
  exception when check_violation then
    null;
  end;
  delete from auth.users where id=u;
end $$;
