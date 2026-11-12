-- BEFORE MIGRATION
create temporary table projection_backfill_fixture(u uuid, g uuid, eligible uuid, ready uuid, building uuid, invalid uuid, detached uuid, failed uuid, obsolete uuid, ready_build uuid, building_build uuid, orphan_job uuid);
create temporary table projection_backfill_batch(runner_id uuid primary key);
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid;
  a uuid:=(f->>'a')::uuid; b uuid:=(f->>'b')::uuid; c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); failed uuid:=gen_random_uuid();
  obsolete_user uuid:=gen_random_uuid(); obsolete uuid:=gen_random_uuid(); obsolete_generation uuid:=gen_random_uuid();
  cat bigint; r uuid; id text; ready_build uuid; building_build uuid; orphan_job uuid; n integer;
begin
  select runner.category_id into cat from public.runners runner where runner.id=a;
  insert into public.runners(id,category_id,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
    values(c,cat,'Building','1990-01-01','M','c@example.invalid','0','Passport','c','M'),
      (d,cat,'Invalid','1990-01-01','M','d@example.invalid','0','Passport','d','M'),
      (e,cat,'Detached','1990-01-01','M','e@example.invalid','0','Passport','e','M'),
      (failed,cat,'Failed','1990-01-01','M','failed@example.invalid','0','Passport','failed','M'),
      (obsolete,cat,'Obsolete','1990-01-01','M','obsolete@example.invalid','0','Passport','obsolete','M');
  insert into public.runner_access values(u,c),(u,d),(u,e),(u,failed);
  perform public.strava_attach_runner(u,c); perform public.strava_attach_runner(u,d); perform public.strava_attach_runner(u,e); perform public.strava_attach_runner(u,failed);
  for r,id in select * from (values(a,'10'),(b,'20'),(c,'30'),(d,'40'),(e,'50'),(failed,'60')) x(r,id) loop
    insert into public.strava_activities(user_id,generation,activity_id,activity)
      values(u,g,id,(pg_temp.fence_detail(id)->0->'activity') || case when r=d then '{"athleteId":"wrong"}'::jsonb else '{}'::jsonb end);
    perform public.strava_store_runner_candidates(u,g,r,pg_temp.fence_batch(r,id)->'candidates');
    perform public.strava_select_runner_activity(u,g,r,id,'{}');
  end loop;
  select build_id into ready_build from public.strava_wrapped_snapshots where runner_id=b;
  perform public.strava_finish_wrapped_snapshot(u,g,b,'20',1,ready_build,'ready','{}');
  select build_id into building_build from public.strava_wrapped_snapshots where runner_id=c;
  perform public.strava_finish_wrapped_snapshot(u,g,failed,'60',1,(select build_id from public.strava_wrapped_snapshots where runner_id=failed),'failed',null,'storage_unavailable');
  update public.strava_jobs set status='failed' where user_id=u and kind='project' and payload->>'runner_id'=failed::text;
  select j.id into orphan_job from public.strava_jobs j where j.user_id=u and j.kind='project' and j.payload->>'runner_id'=a::text;
  delete from public.strava_wrapped_snapshots where runner_id in (a,d);
  delete from public.strava_jobs where user_id=u and kind='project' and payload->>'runner_id'=d::text;
  perform public.strava_detach_runner(u,e);
  insert into auth.users values(obsolete_user);
  insert into public.runner_access values(obsolete_user,obsolete);
  insert into public.strava_connections(user_id,generation,status,athlete_id,granted_scopes)
    values(obsolete_user,obsolete_generation,'active','901',array['activity:read_all']);
  perform public.strava_attach_runner(obsolete_user,obsolete);
  insert into public.strava_activities(user_id,generation,activity_id,activity)
    values(obsolete_user,obsolete_generation,'70',(pg_temp.fence_detail('70')->0->'activity')||'{"athleteId":"901"}');
  perform public.strava_store_runner_candidates(obsolete_user,obsolete_generation,obsolete,pg_temp.fence_batch(obsolete,'70')->'candidates');
  perform public.strava_select_runner_activity(obsolete_user,obsolete_generation,obsolete,'70','{}');
  delete from public.strava_jobs where user_id=obsolete_user and kind='project';
  update public.strava_connections set generation=gen_random_uuid() where user_id=obsolete_user;
  -- Cross the 100-row batch boundary without changing the historical fixtures.
  for n in 1..101 loop
    r:=gen_random_uuid(); id:=(1000+n)::text;
    insert into public.runners(id,category_id,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
      values(r,cat,'Batch','1990-01-01','M','batch@example.invalid','0','Passport','batch','M');
    insert into public.runner_access values(u,r);
    perform public.strava_attach_runner(u,r);
    insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,id,pg_temp.fence_detail(id)->0->'activity');
    perform public.strava_store_runner_candidates(u,g,r,pg_temp.fence_batch(r,id)->'candidates');
    perform public.strava_select_runner_activity(u,g,r,id,'{}');
    insert into projection_backfill_batch values(r);
  end loop;
  delete from public.strava_wrapped_snapshots where runner_id in (select runner_id from projection_backfill_batch);
  delete from public.strava_jobs where user_id=u and kind='project' and payload->>'runner_id' in (select runner_id::text from projection_backfill_batch);
  insert into projection_backfill_fixture values(u,g,a,b,c,d,e,failed,obsolete,ready_build,building_build,orphan_job);
end $$;
-- AFTER MIGRATION
do $$
declare f projection_backfill_fixture; original uuid;
begin
  select * into f from projection_backfill_fixture;
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=f.eligible and status='building' and version=1), 'eligible legacy selection must begin build';
  assert (select count(*)=1 from public.strava_jobs where user_id=f.u and kind='project' and payload->>'runner_id'=f.eligible::text and status='pending'), 'eligible legacy selection must enqueue exactly one job';
  assert exists(select 1 from public.strava_jobs j join public.strava_wrapped_snapshots s
      on s.user_id=j.user_id and s.generation=j.generation and s.runner_id::text=j.payload->>'runner_id'
      join public.strava_runner_attachments a on a.user_id=s.user_id and a.generation=s.generation and a.runner_id=s.runner_id
    where s.runner_id=f.eligible and j.status='pending' and j.payload->>'build_id'=s.build_id::text
      and j.attachment_fences->>s.runner_id::text=a.attachment_id::text), 'new job must fence the exact build and attachment';
  assert not exists(select 1 from public.strava_jobs where id=f.orphan_job), 'obsolete unfinished job must be replaced';
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=f.ready and status='ready' and build_id=f.ready_build), 'ready build must be preserved';
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=f.building and status='building' and build_id=f.building_build), 'building snapshot must be preserved';
  assert (select count(*)=2 from public.strava_jobs where user_id=f.u and kind='project' and payload->>'runner_id' in (f.ready::text,f.building::text)), 'prebuilt jobs must not duplicate';
  assert not exists(select 1 from public.strava_wrapped_snapshots where runner_id in (f.invalid,f.detached,f.obsolete)), 'invalid, detached or obsolete selections must be ignored';
  assert not exists(select 1 from public.strava_jobs where kind='project' and payload->>'runner_id' in (f.invalid::text,f.detached::text,f.obsolete::text)), 'invalid, detached or obsolete selections must not queue';
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=f.failed and status='building'), 'failed selection must get a fresh build';
  assert (select count(*)=1 from public.strava_jobs where user_id=f.u and kind='project' and status='pending' and payload->>'runner_id'=f.failed::text), 'failed selection must get one new job';
  assert (select count(*)=101 from public.strava_wrapped_snapshots s join projection_backfill_batch b using(runner_id) where s.status='building');
  assert (select count(*)=101 from public.strava_jobs j join projection_backfill_batch b on j.payload->>'runner_id'=b.runner_id::text where j.kind='project' and j.status='pending');
  select build_id into original from public.strava_wrapped_snapshots where runner_id=f.eligible;
  perform public.strava_backfill_selected_projections();
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=f.eligible and build_id=original), 'rerun must preserve build';
  assert (select count(*)=1 from public.strava_jobs where user_id=f.u and kind='project' and payload->>'runner_id'=f.eligible::text), 'rerun must not duplicate jobs';
  assert (select count(*)=101 from public.strava_jobs j join projection_backfill_batch b on j.payload->>'runner_id'=b.runner_id::text where j.kind='project'), 'rerun must preserve all batch jobs';
  assert (select count(*)=1 from public.strava_jobs where user_id=f.u and kind='project' and status='pending' and payload->>'runner_id'=f.failed::text), 'rerun must not duplicate failed build retry';
  assert (select count(*)=2 from public.strava_jobs where user_id=f.u and kind='project' and payload->>'runner_id' in (f.ready::text,f.building::text)), 'rerun must preserve prebuilt jobs';
  assert not has_function_privilege('anon','public.strava_backfill_selected_projections()','execute');
  assert not has_function_privilege('authenticated','public.strava_backfill_selected_projections()','execute');
  assert has_function_privilege('service_role','public.strava_backfill_selected_projections()','execute');
end $$;
