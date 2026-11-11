begin;
do $$
declare u uuid := gen_random_uuid(); r uuid := gen_random_uuid(); r2 uuid := gen_random_uuid();
  g uuid; e bigint; c bigint; j jsonb; build uuid; other_build uuid; activity jsonb;
begin
  insert into auth.users values(u);
  insert into public.events(name,event_date) values('Multiple imports','2027-08-17') returning id into e;
  insert into public.categories(event_id,name,distance_km,min_age) values(e,'5K',5,17) returning id into c;
  insert into public.runners(id,category_id,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
    values(r,c,'First','1990-01-01','M','multi1@example.invalid','0','Passport','multi1','M'),
      (r2,c,'Second','1990-01-01','M','multi2@example.invalid','0','Passport','multi2','M');
  insert into public.runner_access values(u,r),(u,r2);
  assert public.strava_begin_runner_oauth(u,r,'multi-first','/wrapped/'||r)='ready';
  perform public.strava_claim_runner_oauth(u,'multi-first');
  assert public.strava_finish_oauth(u,'multi-first','{"athlete_id":"900","access_token":"encrypted","refresh_token":"encrypted","expires_at":"2030-01-01T00:00:00Z","scopes":["activity:read_all"]}')='connected';
  select generation into g from public.strava_connections where user_id=u;
  assert public.strava_runner_opted_in(u,g,r);
  assert public.strava_begin_runner_oauth(u,r2,'multi-second','/wrapped/'||r2)='already_connected', 'Second runner reuses connection';
  assert public.strava_runner_opted_in(u,g,r2);
  assert (select generation=g from public.strava_connections where user_id=u);
  assert not exists(select 1 from public.strava_oauth_attempts where state_hash='multi-second'), 'No second consent exchange';
  delete from public.strava_oauth_attempts where user_id=u;

  -- A failure for the first registration must not block the second registration.
  perform public.strava_enqueue(u,g,'backfill','first-failed',jsonb_build_object('runner_id',r));
  update public.strava_jobs set status='failed' where user_id=u and dedupe_key='first-failed';

  perform public.strava_enqueue(u,g,'backfill','second-page',jsonb_build_object('runner_id',r2));
  j := public.strava_claim_job();
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    p_discoveries=>jsonb_build_array(jsonb_build_object('runner_id',r2,'owner_id','900','object_id','20')));
  assert exists(select 1 from public.strava_jobs where user_id=u and kind='activity' and payload->>'runner_id'=r2::text), 'Second attachment discovers details without OAuth history';
  j := public.strava_claim_job();
  activity := '{"id":"20","athleteId":"900","sportType":"Run","averageHeartrate":150}';
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    p_activities=>jsonb_build_array(jsonb_build_object('id','20','activity',activity)),
    p_runner_candidates=>jsonb_build_array(jsonb_build_object('runner_id',r2,'candidates','[{"activity_id":"20","match_status":"auto_match","reason":"race_checks_passed"}]'::jsonb)));
  assert (select activity_id from public.strava_runner_activities where runner_id=r2)='20';
  other_build := public.strava_begin_wrapped_snapshot(u,g,r2,'20',1);
  assert public.strava_finish_wrapped_snapshot(u,g,r2,'20',1,other_build,'ready','{}')='ready';
  delete from public.strava_jobs where user_id=u and dedupe_key='first-failed';

  perform public.strava_enqueue(u,g,'activity','first-detail',jsonb_build_object('runner_id',r,'object_id','10','owner_id','900'));
  j := public.strava_claim_job();
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    p_activities=>jsonb_build_array(jsonb_build_object('id','10','activity',activity||'{"id":"10"}')),
    p_runner_candidates=>jsonb_build_array(jsonb_build_object('runner_id',r,'candidates','[{"activity_id":"10","match_status":"auto_match","reason":"race_checks_passed"}]'::jsonb)));
  assert (select count(*) from public.strava_runner_activities where user_id=u)=2;
  build := public.strava_begin_wrapped_snapshot(u,g,r,'10',1);
  assert public.strava_detach_runner(u,r)='detached';
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=r2 and status='ready');
  assert public.strava_attach_runner(u,r)='attached';
  assert public.strava_finish_wrapped_snapshot(u,g,r,'10',1,build,'ready','{}')='obsolete';

  -- One provider activity cannot be automatically assigned to two registrations.
  delete from public.strava_activities where user_id=u;
  perform public.strava_enqueue(u,g,'webhook','shared-detail','{}');
  j := public.strava_claim_job();
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    p_activities=>jsonb_build_array(jsonb_build_object('id','30','activity',activity||'{"id":"30"}')),
    p_runner_candidates=>jsonb_build_array(
      jsonb_build_object('runner_id',r,'candidates','[{"activity_id":"30","match_status":"auto_match","reason":"race_checks_passed"}]'::jsonb),
      jsonb_build_object('runner_id',r2,'candidates','[{"activity_id":"30","match_status":"auto_match","reason":"race_checks_passed"}]'::jsonb)));
  assert (select count(*) from public.strava_activity_candidates where user_id=u)=2;
  assert not exists(select 1 from public.strava_runner_activities where user_id=u), 'Shared candidate requires a choice';
  perform public.strava_disconnect(u);
  assert not exists(select 1 from public.strava_runner_attachments where user_id=u);
  assert not exists(select 1 from public.strava_wrapped_snapshots where user_id=u);
  assert public.strava_finish_wrapped_snapshot(u,g,r2,'20',1,other_build,'ready','{}')='obsolete';
  assert not public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid);
end $$;
rollback;
