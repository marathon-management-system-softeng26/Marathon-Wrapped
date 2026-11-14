-- CASE automatic selection
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; g uuid:=(f->>'g')::uuid; j jsonb;
begin
  perform public.strava_enqueue(u,g,'activity','initial',jsonb_build_object('runner_id',a));
  j:=public.strava_claim_job();
  perform public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,pg_temp.fence_detail('10'),
    p_runner_candidates=>jsonb_build_array(pg_temp.fence_batch(a,'10')));
  assert (select count(*)=1 from public.strava_jobs where user_id=u and kind='project' and status='pending'), 'automatic selection must enqueue exactly one projection';
  assert exists(select 1 from public.strava_wrapped_snapshots where user_id=u and runner_id=a and activity_id='10' and version=1 and status='building'), 'selection must begin snapshot atomically';
end $$;

-- CASE disconnect and replaced build reject old completion
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; g uuid:=(f->>'g')::uuid; j jsonb; replacement uuid;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity(u,g,a,'10'); j:=public.strava_claim_job();
  replacement:=public.strava_enqueue_projection(u,g,a,'10');
  assert public.strava_commit_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid,jsonb_build_object('version',1,'runner',jsonb_build_object('id',a,'name','A','bibNumber',null),'event',jsonb_build_object('name','Fence regression','date','2027-08-17','category','5K')),null);
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and build_id=replacement and status='building');
  perform public.strava_disconnect(u);
  assert not public.strava_commit_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid,jsonb_build_object('version',1,'runner',jsonb_build_object('id',a,'name','A','bibNumber',null),'event',jsonb_build_object('name','Fence regression','date','2027-08-17','category','5K')),null);
  assert not exists(select 1 from public.strava_wrapped_snapshots where runner_id=a);
end $$;

-- CASE projection RPC access is service-only
do $$ begin
  assert not has_function_privilege('anon','public.strava_commit_projection_job(uuid,uuid,jsonb,text)','execute');
  assert not has_function_privilege('authenticated','public.strava_commit_projection_refresh_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb)','execute');
  assert has_function_privilege('service_role','public.strava_commit_projection_job(uuid,uuid,jsonb,text)','execute');
  assert not has_function_privilege('service_role','public.strava_commit_runner_job_before_projection(uuid,uuid,jsonb,jsonb,jsonb,jsonb)','execute');
end $$;

-- CASE obsolete connection generation cannot finish
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; g uuid:=(f->>'g')::uuid; j jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity_and_project(u,g,a,'10'); j:=public.strava_claim_job();
  update public.strava_connections set generation=gen_random_uuid() where user_id=u;
  assert not public.strava_commit_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid,jsonb_build_object('version',1,'runner',jsonb_build_object('id',a,'name','A','bibNumber',null),'event',jsonb_build_object('name','Fence regression','date','2027-08-17','category','5K')),null);
  assert not exists(select 1 from public.strava_wrapped_snapshots where runner_id=a);
end $$;

-- CASE other attachment churn retries without publishing stale work
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; b uuid:=(f->>'b')::uuid; g uuid:=(f->>'g')::uuid; j jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity(u,g,a,'10'); j:=public.strava_claim_job();
  perform public.strava_detach_runner(u,b); perform public.strava_attach_runner(u,b);
  assert public.strava_commit_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid,jsonb_build_object('version',1,'runner',jsonb_build_object('id',a,'name','A','bibNumber',null),'event',jsonb_build_object('name','Fence regression','date','2027-08-17','category','5K')),null);
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and status='building'), 'stale build must not publish';
  assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='pending'), 'still-authorized build must retry';
end $$;

-- CASE detached build cannot publish into replacement attachment
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; g uuid:=(f->>'g')::uuid; j jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity(u,g,a,'10'); j:=public.strava_claim_job();
  perform public.strava_detach_runner(u,a); perform public.strava_attach_runner(u,a);
  assert not public.strava_commit_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid,jsonb_build_object('version',1,'runner',jsonb_build_object('id',a,'name','A','bibNumber',null),'event',jsonb_build_object('name','Fence regression','date','2027-08-17','category','5K')),null);
  assert not exists(select 1 from public.strava_wrapped_snapshots where runner_id=a), 'detached build must not survive';
end $$;

-- CASE retry exhaustion fails the build and rate limit delays work
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; g uuid:=(f->>'g')::uuid; j jsonb; n integer;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity(u,g,a,'10');
  j:=public.strava_claim_job();
  assert public.strava_fail_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid,'rate_limited',60,false);
  assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='pending' and available_at>=now()+interval '60 seconds');
  for n in 2..8 loop
    update public.strava_connections set rate_limited_until=null where user_id=u;
    update public.strava_jobs set available_at=now() where id=(j->>'id')::uuid;
    j:=public.strava_claim_job();
    assert public.strava_fail_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid,'storage_unavailable',0,false);
  end loop;
  assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='failed' and attempts=8);
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and status='failed' and error_code='storage_unavailable');
end $$;

-- CASE unchanged webhook rebuilds the existing version
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; g uuid:=(f->>'g')::uuid; j jsonb; prior uuid;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity(u,g,a,'10');
  j:=public.strava_claim_job();
  perform public.strava_commit_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid,jsonb_build_object('version',1,'runner',jsonb_build_object('id',a,'name','A','bibNumber',null),'event',jsonb_build_object('name','Fence regression','date','2027-08-17','category','5K')),null);
  select build_id into prior from public.strava_wrapped_snapshots where runner_id=a;
  perform public.strava_enqueue(u,g,'webhook','refresh','{}'); j:=public.strava_claim_job();
  perform public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,pg_temp.fence_detail('10'),p_runner_candidates=>jsonb_build_array(pg_temp.fence_batch(a,'10')));
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and version=1 and status='building' and build_id<>prior), 'webhook must rebuild same version';
  assert (select count(*)=1 from public.strava_jobs where user_id=u and kind='project' and status='pending');
end $$;

-- CASE qualifying legacy refresh replaces the old build
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; g uuid:=(f->>'g')::uuid; j jsonb; prior uuid;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity(u,g,a,'10');
  select build_id into prior from public.strava_wrapped_snapshots where runner_id=a;
  j:=public.strava_claim_job();
  assert public.strava_commit_projection_refresh_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    '[{"id":"10","activity":{"id":"10","athleteId":"900","sportType":"Run","movingTimeSeconds":100,"elapsedTimeSeconds":100}}]',null,'[]',jsonb_build_array(pg_temp.fence_batch(a,'10')));
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and status='building' and build_id<>prior), 'qualifying refresh must replace build';
  assert (select count(*)=1 from public.strava_jobs where user_id=u and kind='project' and status='pending');
end $$;

-- CASE disqualified legacy refresh removes selection
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; g uuid:=(f->>'g')::uuid; j jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity(u,g,a,'10');
  j:=public.strava_claim_job();
  assert public.strava_commit_projection_refresh_job((j->>'id')::uuid,(j->>'lease_id')::uuid,
    '[{"id":"10","activity":null}]',null,'[]',jsonb_build_array(pg_temp.fence_batch(a,'10','no_match')));
  assert not exists(select 1 from public.strava_runner_activities where runner_id=a), 'disqualified detail must clear selection';
  assert not exists(select 1 from public.strava_wrapped_snapshots where runner_id=a), 'disqualified detail must clear snapshot';
end $$;

-- CASE fenced completion and duplicate delivery
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; g uuid:=(f->>'g')::uuid; j jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  assert public.strava_confirm_runner_activity(u,g,a,'10')='selected';
  j:=public.strava_claim_job();
  assert public.strava_commit_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid,jsonb_build_object('version',1,'runner',jsonb_build_object('id',a,'name','A','bibNumber',null),'event',jsonb_build_object('name','Fence regression','date','2027-08-17','category','5K')),null);
  assert exists(select 1 from public.strava_wrapped_snapshots where user_id=u and runner_id=a and status='ready');
  assert not public.strava_commit_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid,jsonb_build_object('version',1,'runner',jsonb_build_object('id',a,'name','A','bibNumber',null),'event',jsonb_build_object('name','Fence regression','date','2027-08-17','category','5K')),null);
end $$;

-- CASE registration changes during projection force a fresh read
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; g uuid:=(f->>'g')::uuid; j jsonb; payload jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity_and_project(u,g,a,'10'); j:=public.strava_claim_job();
  payload:=jsonb_build_object('version',1,'runner',jsonb_build_object('id',a,'name','A','bibNumber',null),
    'event',jsonb_build_object('name','Fence regression','date','2027-08-17','category','5K'));
  update public.runners set name='Renamed' where id=a;
  assert public.strava_commit_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid,payload,null);
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and status='building'), 'stale registration must not publish';
  assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='pending'), 'changed registration must be retried';
  j:=public.strava_claim_job();
  payload:=jsonb_set(payload,'{runner,name}','"Renamed"');
  assert public.strava_commit_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid,payload,null);
  assert exists(select 1 from public.strava_wrapped_snapshots s where s.runner_id=a and s.status='ready' and s.payload->'runner'->>'name'='Renamed');
end $$;

-- CASE manual selection
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; g uuid:=(f->>'g')::uuid;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  assert public.strava_confirm_runner_activity_and_project(u,g,a,'10')='selected';
  assert public.strava_confirm_runner_activity_and_project(u,g,a,'10')='selected';
  assert (select count(*)=1 from public.strava_jobs where user_id=u and kind='project' and status='pending'), 'manual selection must enqueue exactly one projection';
  assert exists(select 1 from public.strava_wrapped_snapshots where user_id=u and runner_id=a and activity_id='10' and version=1 and status='building'), 'manual selection must begin snapshot atomically';
end $$;
