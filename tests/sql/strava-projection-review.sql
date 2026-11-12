-- CASE legacy workers cannot claim projection jobs
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  assert public.strava_claim_job() is null, 'legacy worker must not consume projection';
  j:=public.strava_claim_projection_aware_job();
  assert j->>'kind'='project', 'updated worker must claim projection';
end $$;

-- CASE expired eighth attempt fails the current snapshot
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  update public.strava_jobs set attempts=7 where user_id=u and kind='project';
  j:=public.strava_claim_projection_aware_job();
  update public.strava_jobs set lease_until=now()-interval '1 second' where id=(j->>'id')::uuid;
  perform public.strava_claim_projection_aware_job();
  assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='failed' and last_error='lease_retry_limit');
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and status='failed' and error_code='lease_retry_limit');
end $$;

-- CASE orphan building snapshots are repaired
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; build uuid;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  select build_id into build from public.strava_wrapped_snapshots where runner_id=a;
  delete from public.strava_jobs where user_id=u and kind='project';
  perform public.strava_backfill_selected_projections();
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and status='building' and build_id<>build);
  assert (select count(*)=1 from public.strava_jobs where user_id=u and kind='project' and status='pending');
end $$;

-- CASE superseded projection failure has no connection side effects
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j jsonb; replacement uuid;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity_and_project(u,g,a,'10'); j:=public.strava_claim_projection_aware_job();
  replacement:=public.strava_enqueue_projection(u,g,a,'10');
  perform public.strava_fail_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid,'reauth_required',null,true);
  assert exists(select 1 from public.strava_connections where user_id=u and status='active' and rate_limited_until is null);
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and build_id=replacement and status='building');
end $$;
-- CASE exact nested snapshot validation
do $$
declare p jsonb:='{"version":1,"runner":{"id":"11111111-1111-1111-1111-111111111111","name":"Runner","bibNumber":null},"event":{"name":"Race","date":"2027-08-17","category":"5K"},"distanceMeters":5000,"movingTimeSeconds":1500,"elapsedTimeSeconds":1550,"averagePaceSecondsPerKm":300,"averageSpeedMps":3.3,"maxSpeedMps":4,"splits":[{"kilometer":1,"distanceMeters":1000,"movingSeconds":300,"elapsedSeconds":310,"averageSpeedMps":3.3,"paceSecondsPerKm":300}],"fastestKilometer":{"kilometer":1,"paceSecondsPerKm":300},"slowestKilometer":{"kilometer":1,"paceSecondsPerKm":300},"paceTrend":{"direction":"even","earlyPaceSecondsPerKm":300,"latePaceSecondsPerKm":300},"averageHeartrate":null,"maxHeartrate":null,"elevationGainMeters":null,"calories":null,"averageCadence":null}';
begin
  assert public.strava_valid_snapshot_v1(p), 'real projection must be valid';
  assert not public.strava_valid_snapshot_v1(jsonb_set(p,'{runner,location}','[1,2]')), 'nested extra field';
  assert not public.strava_valid_snapshot_v1(jsonb_set(p,'{splits,0,movingSeconds}','0.5')), 'fractional duration';
  assert not public.strava_valid_snapshot_v1(jsonb_set(p,'{paceTrend,direction}','"sideways"')), 'invalid direction';
  assert not public.strava_valid_snapshot_v1(p-'event'), 'required event';
  declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j jsonb; ctx jsonb;
  begin
    insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
    perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
    perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
    j:=public.strava_claim_projection_aware_job(); ctx:=public.strava_projection_context(u,g);
    p:=jsonb_set(p,'{runner}',jsonb_build_object('id',a,'name','A','bibNumber',null));
    p:=jsonb_set(p,'{event}',jsonb_build_object('name','Fence regression','date','2027-08-17','category','5K'));
    assert public.strava_commit_projection_fenced((j->>'id')::uuid,(j->>'lease_id')::uuid,p,null,ctx);
    assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and status='ready' and payload=p), 'full valid projection persists';
  end;
end $$;
-- CASE malformed payload cannot finish a snapshot
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; b uuid;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  select build_id into b from public.strava_wrapped_snapshots where runner_id=a;
  begin
    perform public.strava_finish_wrapped_snapshot(u,g,a,'10',1,b,'ready','{"version":1}',null);
    raise exception 'malformed projection accepted';
  exception when check_violation then null; end;
end $$;
-- CASE stale classification context retries refresh
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j jsonb; ctx jsonb; c bigint;
begin
  select category_id into c from public.runners where id=a;
  insert into public.strava_race_configs(category_id,start_time_from,start_time_to,start_latitude,start_longitude,start_radius_m)
    values(c,'2027-08-17T00:00Z','2027-08-17T02:00Z',-6.2,106.8,100);
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity_and_project(u,g,a,'10'); j:=public.strava_claim_projection_aware_job();
  ctx:=public.strava_projection_context(u,g);
  update public.strava_race_configs set start_time_to='2027-08-17T03:00Z',start_latitude=-6.3 where category_id=c;
  update public.categories set name='10K',distance_km=10 where id=c;
  perform public.strava_commit_projection_refresh_fenced((j->>'id')::uuid,(j->>'lease_id')::uuid,'[]',null,'[]','[]',ctx);
  assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='pending'), 'changed classification must retry';
  assert exists(select 1 from public.strava_runner_activities where runner_id=a and activity_id='10'), 'stale classification must not alter selection';
end $$;
-- CASE identical display fields with different registration IDs retry
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j jsonb; ctx jsonb; e bigint; c bigint;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity_and_project(u,g,a,'10'); j:=public.strava_claim_projection_aware_job();
  ctx:=public.strava_projection_context(u,g);
  insert into public.events(name,event_date) values('Fence regression','2027-08-17') returning id into e;
  insert into public.categories(event_id,name,distance_km,min_age) values(e,'5K',5,17) returning id into c;
  update public.runners set category_id=c where id=a;
  perform public.strava_commit_projection_fenced((j->>'id')::uuid,(j->>'lease_id')::uuid,null,'invalid_projection',ctx);
  assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='pending');
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and status='building');
end $$;
-- CASE new projection RPCs are service only
do $$ begin
  assert not has_function_privilege('anon','public.strava_projection_context(uuid,uuid)','execute');
  assert not has_function_privilege('authenticated','public.strava_commit_projection_fenced(uuid,uuid,jsonb,text,jsonb)','execute');
  assert has_function_privilege('service_role','public.strava_commit_projection_fenced(uuid,uuid,jsonb,text,jsonb)','execute');
  assert not has_function_privilege('service_role','public.strava_commit_projection_job(uuid,uuid,jsonb,text)','execute');
  assert not has_function_privilege('service_role','public.strava_commit_projection_refresh_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb)','execute');
end $$;
