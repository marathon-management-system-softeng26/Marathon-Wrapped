begin;

do $$
declare
  u uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  other_runner uuid := gen_random_uuid();
  g uuid;
  old_g uuid;
  e bigint;
  c bigint;
  j jsonb;
  batches jsonb;
  detail jsonb := '{"id":"1","athleteId":"scope-athlete","sportType":"Run","startDate":"2027-08-17T01:00:00Z","distanceMeters":5000,"startLatLng":[0,0],"averageHeartrate":145,"calories":200}';
begin
  insert into auth.users values(u);
  insert into public.events(name,event_date) values('Scope test','2027-08-17') returning id into e;
  insert into public.categories(event_id,name,distance_km,min_age) values(e,'5K',5,17) returning id into c;
  insert into public.strava_race_configs(category_id,start_time_from,start_time_to) values(c,'2027-08-17T00:00:00Z','2027-08-17T02:00:00Z');
  insert into public.runners(id,category_id,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
    values(r,c,'Scoped runner','1990-01-01','M','scope1@example.invalid','0','Passport','scope1','M'),
      (other_runner,c,'Other runner','1990-01-01','M','scope2@example.invalid','0','Passport','scope2','M');
  insert into public.runner_access values(u,r),(u,other_runner);
  assert public.strava_begin_runner_oauth(u,r,'scope-first','/wrapped/'||r::text)='ready';
  assert public.strava_claim_runner_oauth(u,'scope-first')->>'status'='claimed';
  assert public.strava_finish_oauth(u,'scope-first','{"athlete_id":"scope-athlete","access_token":"test","refresh_token":"test","expires_at":"2028-01-01T00:00:00Z","scopes":["activity:read_all"]}')='connected';
  select generation into g from public.strava_connections where user_id=u;
  assert exists(select 1 from public.strava_oauth_attempts where user_id=u and generation=g and runner_id=r and status='connected');
  perform public.strava_enqueue(u,g,'activity','scope-detail','{}');
  j := public.strava_claim_job();
  batches := jsonb_build_array(jsonb_build_object('runner_id',other_runner,'candidates','[{"activity_id":"1","match_status":"auto_match","reason":"race_checks_passed","summary":{}}]'::jsonb));
  begin
    perform public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
      p_activities=>jsonb_build_array(jsonb_build_object('id','1','activity',detail)),p_runner_candidates=>batches);
    raise exception 'Worker must reject another owned runner with identical configuration';
  exception when insufficient_privilege then null;
  end;
  assert (select status from public.strava_jobs where id=(j->>'id')::uuid)='processing', 'Scope rejection rolls back job acknowledgment';
  batches := jsonb_build_array(jsonb_build_object('runner_id',r,'candidates','[{"activity_id":"1","match_status":"auto_match","reason":"race_checks_passed","summary":{}}]'::jsonb));
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    p_activities=>jsonb_build_array(jsonb_build_object('id','1','activity',detail)),p_runner_candidates=>batches);
  assert (select count(*) from public.strava_runner_activities where user_id=u)=1;
  assert exists(select 1 from public.strava_live_metrics where runner_id=r and avg_heartrate=145);
  assert not exists(select 1 from public.strava_activity_candidates where runner_id=other_runner);
  assert public.strava_begin_runner_oauth(u,other_runner,'scope-other','/wrapped/'||other_runner::text)='different_runner';

  -- Disqualification clears the previously selected private snapshot entirely.
  perform public.strava_enqueue(u,g,'webhook','outside-window','{}');
  j := public.strava_claim_job();
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    p_activities=>'[{"id":"1","activity":null},{"id":"unrelated","activity":{"calories":999,"startLatLng":[1,2]}}]');
  assert not exists(select 1 from public.strava_activities where user_id=u), 'No unrelated detail or accumulated tombstones retained';
  assert not exists(select 1 from public.strava_live_metrics where user_id=u), 'Disqualification clears selected health data';
  assert not exists(select 1 from public.strava_activity_candidates where user_id=u);

  old_g := g;
  perform public.strava_disconnect(u);
  assert not exists(select 1 from public.strava_live_metrics where user_id=u);
  -- Emulate completed provider cleanup and reconnect to the other runner through real OAuth RPCs.
  update public.strava_connections set status='disconnected',athlete_id=null,access_token=null,refresh_token=null where user_id=u;
  assert public.strava_begin_runner_oauth(u,other_runner,'scope-second','/wrapped/'||other_runner::text)='ready';
  assert public.strava_claim_runner_oauth(u,'scope-second')->>'status'='claimed';
  assert public.strava_finish_oauth(u,'scope-second','{"athlete_id":"scope-athlete","access_token":"test","refresh_token":"test","expires_at":"2028-01-01T00:00:00Z","scopes":["activity:read_all"]}')='connected';
  select generation into g from public.strava_connections where user_id=u;
  assert g<>old_g;
  perform public.strava_enqueue(u,g,'activity','new-generation','{}');
  j := public.strava_claim_job();
  begin
    perform public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
      p_activities=>jsonb_build_array(jsonb_build_object('id','1','activity',detail)),p_runner_candidates=>batches);
    raise exception 'Old generation runner opt-in must not authorize the new generation';
  exception when insufficient_privilege then null;
  end;
  assert not exists(select 1 from public.strava_activities where user_id=u);
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid), 'Release the rejected fixture job before testing a new page';
  assert not has_function_privilege('anon','public.strava_runner_opted_in(uuid,uuid,uuid)','execute');
  assert not has_function_privilege('authenticated','public.strava_require_runner_opt_in()','execute');
  assert has_function_privilege('service_role','public.strava_runner_opted_in(uuid,uuid,uuid)','execute');
  -- An explicit Connect can bind an older active grant, but cannot transfer it.
  delete from public.strava_oauth_attempts where user_id=u and generation=g;
  assert public.strava_begin_runner_oauth(u,r,'scope-legacy','/wrapped/'||r::text)='already_connected';
  assert public.strava_runner_opted_in(u,g,r);
  assert public.strava_begin_runner_oauth(u,r,'scope-repeat','/wrapped/'||r::text)='already_connected';
  assert (select count(*) from public.strava_oauth_attempts where user_id=u and generation=g and status='connected')=1;
  update public.strava_oauth_attempts set expires_at=now()-interval '2 days' where user_id=u and generation=g;
  assert public.strava_runner_opted_in(u,g,r), 'Completed opt-in survives callback expiry';
  perform public.strava_enqueue(u,g,'backfill','scoped-page',jsonb_build_object('runner_id',r,'after',1818460799,'before',1818468001,'page',1));
  j := public.strava_claim_job();
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    p_continuation=>jsonb_build_object('key','scoped-next','payload',jsonb_build_object('runner_id',r,'after',1818460799,'before',1818468001,'page',2)),
    p_discoveries=>jsonb_build_array(jsonb_build_object('object_id','2','owner_id','scope-athlete','runner_id',r),jsonb_build_object('object_id','2','owner_id','scope-athlete','runner_id',r)));
  assert not public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid), 'Scoped page completion remains idempotent';
  assert (select count(*) from public.strava_jobs where user_id=u and dedupe_key='scoped-next')=1;
  assert (select count(*) from public.strava_jobs where user_id=u and kind='activity' and payload->>'object_id'='2' and payload->>'runner_id'=r::text)=1;
end $$;

rollback;
