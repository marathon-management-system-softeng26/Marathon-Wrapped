begin;

do $$
declare
  u uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  g uuid := gen_random_uuid();
  e bigint;
  c bigint;
  j jsonb;
  activity jsonb := '{"id":"one","athleteId":"2","sportType":"Run","startDate":"2027-08-17T01:00:00Z","distanceMeters":5000,"startLatLng":[-6.2,106.8],"averageHeartrate":145.5,"maxHeartrate":null,"elevationGainMeters":0,"calories":null,"averageCadence":80.5}';
  batches jsonb;
begin
  insert into auth.users values (u);
  insert into public.events(name,event_date) values ('Worker test','2027-08-17') returning id into e;
  insert into public.categories(event_id,name,distance_km,min_age) values(e,'5K',5,17) returning id into c;
  insert into public.runners(id,category_id,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
    values(r,c,'Worker runner','1990-01-01','M','worker@example.invalid','0','Passport','worker','M');
  insert into public.runner_access values(u,r);
  insert into public.strava_connections(user_id,generation,status,athlete_id) values(u,g,'active','2');
  insert into public.strava_oauth_attempts(state_hash,user_id,generation,status,runner_id,return_path)
    values('worker-scope',u,g,'connected',r,'/wrapped/'||r::text);
  insert into public.strava_metrics(runner_id,avg_heartrate,data_source) values(r,123,'demo');
  batches := jsonb_build_array(jsonb_build_object('runner_id',r,'candidates',jsonb_build_array(
    jsonb_build_object('activity_id','one','match_status','auto_match','reason','race_checks_passed','summary','{}'::jsonb))));

  perform public.strava_enqueue(u,g,'backfill','empty','{}');
  j := public.strava_claim_job();
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid);
  assert not exists(select 1 from public.strava_runner_activities where runner_id=r), 'Zero matches stay unselected';

  perform public.strava_enqueue(u,g,'activity','one','{}');
  perform public.strava_enqueue(u,g,'backfill','next-page','{}');
  -- Choose deterministic job order without relying on generated UUID ordering.
  update public.strava_jobs set available_at=now()-interval '1 minute' where user_id=u and dedupe_key='one';
  j := public.strava_claim_job();
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    p_activities=>jsonb_build_array(jsonb_build_object('id','one','activity',activity)),p_runner_candidates=>batches);
  assert not exists(select 1 from public.strava_runner_activities where runner_id=r), 'Wait for every discovery page and detail';
  assert (select count(*) from public.strava_activity_candidates where runner_id=r)=1;
  j := public.strava_claim_job();
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid);
  assert (select activity_id from public.strava_runner_activities where runner_id=r)='one', 'One full match auto selects after discovery';
  assert (select avg_heartrate=145.5 and max_heartrate is null and elevation_gain_m=0 and calories is null and avg_cadence=80.5
    from public.strava_live_metrics where runner_id=r), 'Only normalized metrics materialize, preserving nulls, zero and fractions';
  assert not public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid), 'Duplicate completion is a no-op';

  perform public.strava_enqueue(u,g,'activity','repeat-one','{}');
  j := public.strava_claim_job();
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    p_activities=>jsonb_build_array(jsonb_build_object('id','one','activity',activity)),p_runner_candidates=>batches);
  assert (select count(*) from public.strava_activity_candidates where runner_id=r)=1, 'Repeated detail upserts';
  assert (select count(*) from public.strava_live_metrics where runner_id=r)=1, 'Repeated selection remains singleton';
  assert (select selection_source from public.strava_runner_activities where runner_id=r)='auto';
  assert public.strava_select_runner_activity(u,g,r,'one','{"avg_heartrate":145.5}')='selected';
  assert (select selection_source from public.strava_runner_activities where runner_id=r)='manual', 'Confirming the same automatic choice promotes provenance';
  -- Restore automatic provenance to exercise discovery of a second match below.
  update public.strava_runner_activities set selection_source='auto' where runner_id=r;

  perform public.strava_enqueue(u,g,'activity','second','{}');
  perform public.strava_enqueue(u,g,'backfill','still-importing','{}');
  update public.strava_jobs set available_at=now()-interval '1 minute' where user_id=u and dedupe_key='second';
  j := public.strava_claim_job();
  batches := jsonb_build_array(jsonb_build_object('runner_id',r,'candidates',jsonb_build_array(
    jsonb_build_object('activity_id','two','match_status','auto_match','reason','race_checks_passed','summary','{}'::jsonb))));
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    p_activities=>jsonb_build_array(jsonb_build_object('id','two','activity',activity||'{"id":"two"}')),p_runner_candidates=>batches);
  assert not exists(select 1 from public.strava_runner_activities where runner_id=r), 'Two qualifying activities require confirmation';
  assert not exists(select 1 from public.strava_live_metrics where runner_id=r), 'Ambiguity clears prior automatic metrics';
  j := public.strava_claim_job();
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid);
  assert public.strava_select_runner_activity(u,g,r,'two','{"calories":10}')='selected';
  perform public.strava_enqueue(u,g,'backfill','unrelated','{}');
  j := public.strava_claim_job();
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid);
  assert (select activity_id from public.strava_runner_activities where runner_id=r)='two', 'Unrelated jobs preserve a manual selection';
  assert (select calories from public.strava_live_metrics where runner_id=r)=10;
  perform public.strava_enqueue(u,g,'activity','refresh-manual','{}');
  j := public.strava_claim_job();
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    p_activities=>jsonb_build_array(jsonb_build_object('id','two','activity',activity||'{"id":"two","calories":200}')),p_runner_candidates=>batches);
  assert (select activity_id='two' and selection_source='manual' from public.strava_runner_activities where runner_id=r), 'Updated qualifying details preserve the manual choice';
  assert (select calories from public.strava_live_metrics where runner_id=r)=200, 'Refresh replaces the selected live metrics';
  -- Reclassification of the selected detail invalidates even manual selection.
  perform public.strava_store_runner_candidates(u,g,r,'[{"activity_id":"two","match_status":"no_match","reason":"wrong_sport","summary":{}}]');
  assert not exists(select 1 from public.strava_runner_activities where runner_id=r);

  perform public.strava_enqueue(u,g,'activity','missing-gps','{}');
  j := public.strava_claim_job();
  batches := jsonb_build_array(jsonb_build_object('runner_id',r,'candidates','[
    {"activity_id":"one","match_status":"no_match","reason":"wrong_sport","summary":{}},
    {"activity_id":"two","match_status":"needs_confirmation","reason":"missing_start_location","summary":{}}]'::jsonb));
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,p_runner_candidates=>batches);
  assert not exists(select 1 from public.strava_runner_activities where runner_id=r), 'Missing GPS never auto selects';

  perform public.strava_enqueue(u,g,'activity','rollback','{}');
  j := public.strava_claim_job();
  batches := jsonb_build_array(jsonb_build_object('runner_id',r,'candidates','[
    {"activity_id":"two","match_status":"auto_match","reason":"race_checks_passed","summary":{}}]'::jsonb));
  begin
    perform public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
      p_activities=>jsonb_build_array(jsonb_build_object('id','two','activity',activity||'{"id":"two","calories":-1}')),p_runner_candidates=>batches);
    raise exception 'Expected invalid metric rejection';
  exception when check_violation then null;
  end;
  assert (select status from public.strava_jobs where id=(j->>'id')::uuid)='processing', 'Matching failure cannot complete the job';
  assert (select a.activity->>'calories' from public.strava_activities a where user_id=u and activity_id='two')='200', 'Snapshot rolled back with failed metrics';
  assert (select match_status from public.strava_activity_candidates where runner_id=r and activity_id='two')='needs_confirmation';
  perform public.strava_disconnect(u);
  assert not public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    p_activities=>jsonb_build_array(jsonb_build_object('id','two','activity',activity)),p_runner_candidates=>batches), 'Disconnect wins against in-flight workers';
  assert not exists(select 1 from public.strava_live_metrics where runner_id=r);
  assert not exists(select 1 from public.strava_activity_candidates where runner_id=r);
  assert (select avg_heartrate=123 and data_source='demo' from public.strava_metrics where runner_id=r), 'Demo metrics untouched';
  assert not has_function_privilege('anon','public.strava_commit_runner_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb)','execute');
  assert not has_function_privilege('authenticated','public.strava_commit_runner_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb)','execute');
  assert has_function_privilege('service_role','public.strava_commit_runner_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb)','execute');
end $$;

do $$
declare
  u uuid := gen_random_uuid();
  g uuid := gen_random_uuid();
  j jsonb;
begin
  insert into auth.users values(u);
  insert into public.strava_connections(user_id,generation,status,athlete_id) values(u,g,'active','repeated-pages');
  perform public.strava_enqueue(u,g,'backfill','page-one','{}');
  perform public.strava_enqueue(u,g,'backfill','page-one','{}');
  assert (select count(*) from public.strava_jobs where user_id=u)=1, 'Duplicate backfill enqueue shares the same page';
  -- Avoid other users' durable revoke work when exercising this isolated page.
  select to_jsonb(q) into j from public.strava_jobs q where user_id=u;
  update public.strava_jobs set status='processing',lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes'
    where id=(j->>'id')::uuid returning to_jsonb(strava_jobs.*) into j;
  assert not public.strava_commit_runner_job((j->>'id')::uuid,gen_random_uuid()), 'An obsolete lease cannot store or select';
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    p_continuation=>'{"key":"page-two","payload":{"page":2}}',
    p_discoveries=>'[{"object_id":"one","owner_id":"repeated-pages"},{"object_id":"one","owner_id":"repeated-pages"}]');
  assert not public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    p_continuation=>'{"key":"page-two","payload":{"page":2}}',
    p_discoveries=>'[{"object_id":"one","owner_id":"repeated-pages"}]');
  assert (select count(*) from public.strava_jobs where user_id=u and kind='activity')=0, 'Unscoped legacy page cannot discover details';
  assert (select count(*) from public.strava_jobs where user_id=u and dedupe_key='page-two')=0, 'Unscoped legacy page cannot continue';
end $$;

rollback;
