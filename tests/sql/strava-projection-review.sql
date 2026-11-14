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
  assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='complete' and lease_id is null and lease_until is null), 'obsolete job must be acknowledged';
  assert exists(select 1 from public.strava_jobs where payload->>'build_id'=replacement::text and status='pending'), 'replacement must remain runnable';
  assert public.strava_claim_projection_aware_job()->'payload'->>'build_id'=replacement::text, 'replacement must be claimable immediately';
end $$;
-- CASE exact nested snapshot validation
do $$
declare p jsonb:='{"version":1,"runner":{"id":"11111111-1111-1111-1111-111111111111","name":"Runner","bibNumber":null},"event":{"name":"Race","date":"2027-08-17","category":"5K"},"distanceMeters":5000,"movingTimeSeconds":1500,"elapsedTimeSeconds":1550,"averagePaceSecondsPerKm":300,"averageSpeedMps":3.3,"maxSpeedMps":4,"splits":[{"kilometer":1,"distanceMeters":1000,"movingSeconds":300,"elapsedSeconds":310,"averageSpeedMps":3.3,"paceSecondsPerKm":300}],"fastestKilometer":{"kilometer":1,"paceSecondsPerKm":300},"slowestKilometer":{"kilometer":1,"paceSecondsPerKm":300},"paceTrend":{"direction":"even","earlyPaceSecondsPerKm":300,"latePaceSecondsPerKm":300},"averageHeartrate":null,"maxHeartrate":null,"elevationGainMeters":null,"calories":null,"averageCadence":null}';
begin
  assert public.strava_valid_snapshot_v1(p), 'real projection must be valid';
  assert not public.strava_valid_snapshot_v1(jsonb_set(p,'{runner,location}','[1,2]')), 'nested extra field';
  assert not public.strava_valid_snapshot_v1(jsonb_set(p,'{splits,0,movingSeconds}','0.5')), 'fractional duration';
  assert not public.strava_valid_snapshot_v1(jsonb_set(p,'{paceTrend,direction}','"sideways"')), 'invalid direction';
  assert not public.strava_valid_snapshot_v1(jsonb_set(p,'{runner,id}','null')), 'runner id cannot be null';
  assert not public.strava_valid_snapshot_v1(jsonb_set(p,'{event,date}','null')), 'event date cannot be null';
  assert not public.strava_valid_snapshot_v1(jsonb_set(p,'{splits,0,kilometer}','null')), 'split marker cannot be null';
  assert not public.strava_valid_snapshot_v1(jsonb_set(p,'{fastestKilometer,paceSecondsPerKm}','null')), 'insight pace cannot be null';
  assert not public.strava_valid_snapshot_v1(jsonb_set(p,'{paceTrend,earlyPaceSecondsPerKm}','null')), 'trend pace cannot be null';
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
-- CASE processing without lease is an orphan
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; old_build uuid;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  select build_id into old_build from public.strava_wrapped_snapshots where runner_id=a;
  update public.strava_jobs set status='processing',lease_id=null,lease_until=null where user_id=u and kind='project';
  perform public.strava_backfill_selected_projections();
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and build_id<>old_build and status='building');
  assert exists(select 1 from public.strava_jobs where user_id=u and kind='project' and status='pending');
end $$;
-- CASE null trend direction rejected at persistence
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; b uuid; p jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates'); perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  select build_id into b from public.strava_wrapped_snapshots where runner_id=a;
  p:=jsonb_build_object('version',1,'runner',jsonb_build_object('id',a,'name','A','bibNumber',null),'event',jsonb_build_object('name','Fence regression','date','2027-08-17','category','5K'),'distanceMeters',5000,'movingTimeSeconds',1500,'elapsedTimeSeconds',1500,'averagePaceSecondsPerKm',300,'averageSpeedMps',null,'maxSpeedMps',null,'splits','[]'::jsonb,'fastestKilometer',null,'slowestKilometer',null,'paceTrend',jsonb_build_object('direction',null,'earlyPaceSecondsPerKm',300,'latePaceSecondsPerKm',300),'averageHeartrate',null,'maxHeartrate',null,'elevationGainMeters',null,'calories',null,'averageCadence',null);
  begin perform public.strava_finish_wrapped_snapshot(u,g,a,'10',1,b,'ready',p,null); raise exception 'null direction accepted';
  exception when check_violation then null; end;
end $$;
-- CASE old generic failure releases projection without connection effects
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates'); perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  j:=public.strava_claim_projection_aware_job();
  perform public.strava_commit_job((j->>'id')::uuid,(j->>'lease_id')::uuid,p_error=>'reauth_required',p_reauth=>true);
  assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='pending');
  assert exists(select 1 from public.strava_connections where user_id=u and status='active');
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and status='building');
end $$;
-- CASE stale project credential failure cannot reauthorize replacement
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j jsonb; claim jsonb; replacement uuid;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates'); perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  j:=public.strava_claim_projection_aware_job();
  claim:=public.strava_claim_project_credentials(u,'refresh',(j->>'id')::uuid,(j->>'lease_id')::uuid);
  assert claim->>'operation_id' is not null;
  replacement:=public.strava_enqueue_projection(u,g,a,'10');
  assert not public.strava_finish_project_refresh(u,(claim->>'operation_id')::uuid,g,null,true,false,(j->>'id')::uuid,(j->>'lease_id')::uuid);
  perform public.strava_fail_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid,'authorization_revoked',null,false);
  assert exists(select 1 from public.strava_connections where user_id=u and status='active' and operation_id is null);
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and build_id=replacement and status='building');
  assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='complete' and lease_id is null), 'stale credential job must be acknowledged';
  assert public.strava_claim_projection_aware_job()->'payload'->>'build_id'=replacement::text, 'replacement must not wait for old credential job';
end $$;
-- CASE legacy runner acknowledgement releases leased projection
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates'); perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  j:=public.strava_claim_projection_aware_job();
  assert public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,'[]',null,'[]','[]');
  assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='pending' and lease_id is null);
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and status='building');
  assert public.strava_claim_projection_aware_job()->>'kind'='project';
end $$;
-- CASE fenced legacy refresh remains functional
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j jsonb; ctx jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates'); perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  j:=public.strava_claim_projection_aware_job(); ctx:=public.strava_projection_context(u,g);
  assert public.strava_commit_projection_refresh_fenced((j->>'id')::uuid,(j->>'lease_id')::uuid,pg_temp.fence_detail('10'),null,'[]',jsonb_build_array(pg_temp.fence_batch(a,'10')),ctx);
  assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='complete');
end $$;
-- CASE registration locks are ordered from parents to children
do $$
declare definition text:=pg_get_functiondef('public.strava_projection_context_matches(uuid,uuid,jsonb)'::regprocedure);
begin
  assert position('from public.events e' in definition)<position('from public.categories cat' in definition);
  assert position('from public.categories cat' in definition)<position('from public.runners r' in definition);
  assert position('from public.runners r' in definition)<position('from public.runner_access access' in definition);
  assert position('from public.runner_access access' in definition)<position('from public.strava_race_configs race' in definition);
end $$;
-- CASE deleting a classification configuration retries
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; c bigint; j jsonb; ctx jsonb;
begin
  select category_id into c from public.runners where id=a;
  insert into public.strava_race_configs(category_id,start_time_from,start_time_to) values(c,'2027-08-17T00:00Z','2027-08-17T02:00Z');
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates'); perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  j:=public.strava_claim_projection_aware_job(); ctx:=public.strava_projection_context(u,g);
  delete from public.strava_race_configs where category_id=c;
  perform public.strava_commit_projection_refresh_fenced((j->>'id')::uuid,(j->>'lease_id')::uuid,'[]',null,'[]','[]',ctx);
  assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='pending');
end $$;
-- CASE stale uncertain credential result blocks another refresh
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j jsonb; claim jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates'); perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  j:=public.strava_claim_projection_aware_job(); claim:=public.strava_claim_project_credentials(u,'refresh',(j->>'id')::uuid,(j->>'lease_id')::uuid);
  perform public.strava_enqueue_projection(u,g,a,'10');
  perform public.strava_finish_project_refresh(u,(claim->>'operation_id')::uuid,g,null,true,true,(j->>'id')::uuid,(j->>'lease_id')::uuid);
  assert exists(select 1 from public.strava_connections where user_id=u and status='active' and credentials_uncertain);
  assert public.strava_claim_credentials(u,'refresh') is null, 'uncertain credentials cannot be refreshed';
  delete from public.strava_jobs where id=(j->>'id')::uuid;
  j:=public.strava_claim_projection_aware_job();
  assert public.strava_claim_project_credentials(u,'refresh',(j->>'id')::uuid,(j->>'lease_id')::uuid) is null, 'uncertain credentials cannot be refreshed by a new project';
end $$;
-- CASE null operation cannot update credentials
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid;
begin
  assert not public.strava_finish_refresh(u,null,g,'{"access_token":"injected"}',false,false), 'null operation cannot finish';
  assert (select access_token is null from public.strava_connections where user_id=u);
end $$;
-- CASE null projection lease cannot discard job
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j uuid;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates'); perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  update public.strava_jobs set status='processing',lease_id=null,lease_until=now()+interval '1 minute' where user_id=u and kind='project' returning id into j;
  assert not public.strava_discard_projection_job(j,null), 'null lease must not discard';
  assert exists(select 1 from public.strava_jobs where id=j and status='processing');
end $$;
-- CASE current invalid refresh terminal transition clears connection atomically
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j jsonb; claim jsonb;
begin
  update public.strava_connections set access_token='access',refresh_token='refresh' where user_id=u;
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates'); perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  j:=public.strava_claim_projection_aware_job(); claim:=public.strava_claim_project_credentials(u,'refresh',(j->>'id')::uuid,(j->>'lease_id')::uuid);
  perform public.strava_finish_project_refresh_v2(u,(claim->>'operation_id')::uuid,g,null,false,false,(j->>'id')::uuid,(j->>'lease_id')::uuid,true);
  assert exists(select 1 from public.strava_connections where user_id=u and status='disconnected' and access_token is null and refresh_token is null);
  assert not exists(select 1 from public.strava_wrapped_snapshots where runner_id=a);
end $$;
-- CASE held pre-cutover generic body cannot change project or connection
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates'); perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  j:=public.strava_claim_projection_aware_job();
  begin
    perform public.strava_commit_job_internal((j->>'id')::uuid,(j->>'lease_id')::uuid,p_error=>'reauth_required',p_reauth=>true);
  exception when insufficient_privilege then null; end;
  begin
    perform public.strava_commit_job_internal((j->>'id')::uuid,(j->>'lease_id')::uuid,p_error=>'rate_limited',p_delay=>60);
  exception when insufficient_privilege then null; end;
  begin
    perform public.strava_commit_job_internal((j->>'id')::uuid,(j->>'lease_id')::uuid);
  exception when insufficient_privilege then null; end;
  assert exists(select 1 from public.strava_connections where user_id=u and status='active' and rate_limited_until is null);
  assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='processing');
end $$;
-- CASE removed direct access cannot revoke the shared connection
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; b uuid:=(f->>'b')::uuid; j jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates'); perform public.strava_confirm_runner_activity_and_project(u,g,a,'10'); j:=public.strava_claim_projection_aware_job();
  delete from public.runner_access where user_id=u and runner_id=a;
  perform public.strava_fail_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid,'authorization_revoked',null,false);
  assert exists(select 1 from public.strava_connections where user_id=u and status='active');
  assert exists(select 1 from public.strava_runner_attachments where user_id=u and runner_id=b and status='active');
end $$;
-- CASE lock fence uses nonwaiting registration locks
do $$
declare definition text:=pg_get_functiondef('public.strava_projection_context_matches(uuid,uuid,jsonb)'::regprocedure);
begin
  assert (length(definition)-length(replace(definition,'nowait','')))/length('nowait')>=5;
end $$;
-- CASE null generic project lease cannot be acknowledged
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j uuid;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates'); perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  update public.strava_jobs set status='processing',lease_id=null,lease_until=now()+interval '1 minute' where user_id=u and kind='project' returning id into j;
  assert not public.strava_commit_job(j,null), 'null lease must not be acknowledged';
end $$;
