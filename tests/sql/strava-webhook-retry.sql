-- CASE webhook retry applies deletion after another runner changes
 do $$
 declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; b uuid:=(f->>'b')::uuid; g uuid:=(f->>'g')::uuid; j jsonb; retry jsonb; build uuid;
 begin
  perform public.strava_enqueue(u,g,'activity','initial',jsonb_build_object('runner_id',a)); j:=public.strava_claim_job();
  perform public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,pg_temp.fence_detail('10'),p_runner_candidates=>jsonb_build_array(pg_temp.fence_batch(a,'10')));
  build:=public.strava_begin_wrapped_snapshot(u,g,a,'10',1); perform public.strava_finish_wrapped_snapshot(u,g,a,'10',1,build,'ready','{}');
  perform public.strava_enqueue(u,g,'webhook','delete-10','{"object_type":"activity","aspect_type":"delete","object_id":10}'); j:=public.strava_claim_job();
  perform public.strava_detach_runner(u,b); perform public.strava_attach_runner(u,b);
  perform public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,'[{"id":"10","activity":null}]');
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and status='ready'), 'stale response published';
  assert (select status='pending' from public.strava_jobs where id=(j->>'id')::uuid), 'webhook was not requeued';
  perform public.strava_enqueue(u,g,'webhook','delete-10','{}');
  assert (select count(*)=1 from public.strava_jobs where generation=g and dedupe_key='delete-10'), 'duplicate webhook created extra job';
  retry:=public.strava_claim_job();
  assert retry->>'id'=j->>'id', 'retry did not reuse job';
  perform public.strava_commit_runner_job((retry->>'id')::uuid,(retry->>'lease_id')::uuid,'[{"id":"10","activity":null}]');
  assert not exists(select 1 from public.strava_runner_activities where runner_id=a), 'delete left selection';
  assert not exists(select 1 from public.strava_wrapped_snapshots where runner_id=a), 'delete left snapshot';
  assert (select status='complete' from public.strava_jobs where id=(j->>'id')::uuid), 'retry did not finish';
 end $$;
-- CASE automatic downgrade requires confirmation
 do $$
 declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; g uuid:=(f->>'g')::uuid; j jsonb; build uuid;
 begin
  perform public.strava_enqueue(u,g,'activity','initial',jsonb_build_object('runner_id',a)); j:=public.strava_claim_job();
  perform public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,pg_temp.fence_detail('10'),p_runner_candidates=>jsonb_build_array(pg_temp.fence_batch(a,'10')));
  assert exists(select 1 from public.strava_runner_activities where runner_id=a and selection_source='auto'), 'fixture not automatic';
  build:=public.strava_begin_wrapped_snapshot(u,g,a,'10',1); perform public.strava_finish_wrapped_snapshot(u,g,a,'10',1,build,'ready','{}');
  perform public.strava_enqueue(u,g,'webhook','downgrade','{}'); j:=public.strava_claim_job();
  perform public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,pg_temp.fence_detail('10'),p_runner_candidates=>jsonb_build_array(pg_temp.fence_batch(a,'10','needs_confirmation')));
  assert not exists(select 1 from public.strava_runner_activities where runner_id=a), 'automatic selection survived downgrade';
  assert not exists(select 1 from public.strava_wrapped_snapshots where runner_id=a), 'automatic snapshot survived downgrade';
  assert exists(select 1 from public.strava_activity_candidates where runner_id=a and match_status='needs_confirmation'), 'candidate must require confirmation';
 end $$;
-- CASE manual confirmation survives a downgrade
 do $$
 declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; g uuid:=(f->>'g')::uuid; j jsonb;
 begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  assert public.strava_confirm_runner_activity(u,g,a,'10')='selected';
  perform public.strava_enqueue(u,g,'webhook','manual','{}'); j:=public.strava_claim_job();
  perform public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,pg_temp.fence_detail('10'),p_runner_candidates=>jsonb_build_array(pg_temp.fence_batch(a,'10','needs_confirmation')));
  assert exists(select 1 from public.strava_runner_activities where runner_id=a and activity_id='10' and selection_source='manual'), 'manual selection lost';
 end $$;
-- CASE repeated attachment churn respects the retry limit
 do $$
 declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; b uuid:=(f->>'b')::uuid; g uuid:=(f->>'g')::uuid; j jsonb; n integer;
 begin
  perform public.strava_enqueue(u,g,'webhook','churn','{}');
  for n in 1..8 loop
    j:=public.strava_claim_job(); assert j is not null, 'retry unavailable';
    perform public.strava_detach_runner(u,b); perform public.strava_attach_runner(u,b);
    perform public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid);
  end loop;
  assert (select status='failed' and attempts=8 and last_error='attachment_changed' from public.strava_jobs where id=(j->>'id')::uuid), 'retry limit not enforced';
  perform public.strava_enqueue(u,g,'webhook','churn','{}');
  assert (select count(*)=1 from public.strava_jobs where generation=g and dedupe_key='churn'), 'duplicate bypassed retry limit';
 end $$;
