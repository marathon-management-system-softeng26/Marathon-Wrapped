create temporary table candidate_summary_fixture (data jsonb);

do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid;
  a uuid:=(f->>'a')::uuid; g uuid:=(f->>'g')::uuid; build uuid;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values
    (u,g,'10','{"id":"10","athleteId":"900","sportType":"Run","startDate":"2027-08-17T00:15:00Z","distanceMeters":5000,"gpsAvailable":true}');
  perform public.strava_store_runner_candidates(u,g,a,'[{"activity_id":"10","match_status":"auto_match",
    "reason":"race_checks_passed","summary":{"id":"10","sportType":"Run","startDate":"2027-08-17T00:15:00Z",
    "distanceMeters":5000,"map":{"polyline":"private"}}}]');
  assert public.strava_confirm_runner_activity(u,g,a,'10')='selected';
  build:=public.strava_begin_wrapped_snapshot(u,g,a,'10',1);
  assert public.strava_finish_wrapped_snapshot(u,g,a,'10',1,build,'ready','{"version":1}')='ready';
  insert into candidate_summary_fixture values (f||jsonb_build_object('build',build));
end $$;

-- AFTER MIGRATION

do $$
declare f jsonb:=(select data from candidate_summary_fixture); u uuid:=(f->>'u')::uuid;
  a uuid:=(f->>'a')::uuid; b uuid:=(f->>'b')::uuid; g uuid:=(f->>'g')::uuid; j jsonb;
begin
  assert (select summary='{"startDate":"2027-08-17T00:15:00Z","distanceMeters":5000,"gpsAvailable":true}'
    from public.strava_activity_candidates where runner_id=a and activity_id='10'),
    'legacy candidate did not retain only the safe display summary';

  perform public.strava_enqueue(u,g,'activity','fresh-scoped-summary',jsonb_build_object('runner_id',b));
  j:=public.strava_claim_job();
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    '[{"id":"10","activity":{"id":"10","athleteId":"900","sportType":"Run",
    "startDate":"2027-08-17T01:05:00.000Z","distanceMeters":5240,"gpsAvailable":false}}]',
    p_runner_candidates=>jsonb_build_array(jsonb_build_object('runner_id',b,'candidates',
      '[{"activity_id":"10","match_status":"needs_confirmation","reason":"missing_start_location",
      "summary":{"startDate":"2027-08-17T01:05:00.000Z","distanceMeters":5240,"gpsAvailable":false,
      "route":{"polyline":"private"},"startLatLng":[-6.2,106.8],"rawPayload":{}}}]'::jsonb)));
  assert (select summary='{"startDate":"2027-08-17T01:05:00.000Z","distanceMeters":5240,"gpsAvailable":false}'
    from public.strava_activity_candidates where runner_id=b and activity_id='10'),
    'scoped candidate did not retain only its fresh safe summary';
  assert (select activity->'gpsAvailable'='true'::jsonb and activity->'distanceMeters'='5000'::jsonb
    and activity->>'startDate'='2027-08-17T00:15:00Z' from public.strava_activities where user_id=u and activity_id='10'),
    'scoped discovery replaced the shared activity';
  assert (select summary->'gpsAvailable'='true'::jsonb and summary->'distanceMeters'='5000'::jsonb
    from public.strava_activity_candidates where runner_id=a and activity_id='10'),
    'scoped discovery changed the other runner candidate';
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and build_id=(f->>'build')::uuid and status='ready'),
    'scoped discovery invalidated the other runner snapshot';

  perform public.strava_store_runner_candidates(u,g,b,'[{"activity_id":"10","match_status":"needs_confirmation",
    "reason":"missing_start_location","summary":{"startDate":"private", "distanceMeters":{"coordinates":[1,2]},
    "gpsAvailable":"true"}}]');
  assert (select summary='{}'::jsonb from public.strava_activity_candidates where runner_id=b and activity_id='10'),
    'malformed summary did not fall back to the empty default';

  perform public.strava_enqueue(u,g,'activity','stale-scoped-summary',jsonb_build_object('runner_id',b));
  j:=public.strava_claim_job();
  assert public.strava_detach_runner(u,b)='detached';
  assert public.strava_attach_runner(u,b)='attached';
  assert not public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    p_runner_candidates=>jsonb_build_array(jsonb_build_object('runner_id',b,'candidates',
      '[{"activity_id":"10","match_status":"needs_confirmation","reason":"missing_start_location",
      "summary":{"startDate":"2027-08-17T01:05:00.000Z","distanceMeters":5240,"gpsAvailable":false}}]'::jsonb)));
  assert not exists(select 1 from public.strava_activity_candidates where runner_id=b and activity_id='10'),
    'old discovery published a candidate summary into a replacement attachment';
  delete from auth.users where id=u;
end $$;
