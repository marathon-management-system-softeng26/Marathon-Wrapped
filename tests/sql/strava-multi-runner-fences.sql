create or replace function pg_temp.runner_fence_fixture() returns jsonb language plpgsql as $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); g uuid:=gen_random_uuid(); e bigint; c bigint;
begin
  insert into auth.users values(u);
  insert into public.events(name,event_date) values('Fence regression','2027-08-17') returning id into e;
  insert into public.categories(event_id,name,distance_km,min_age) values(e,'5K',5,17) returning id into c;
  insert into public.runners(id,category_id,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
    values(a,c,'A','1990-01-01','M','fence-a@example.invalid','0','Passport','fence-a','M'),
      (b,c,'B','1990-01-01','M','fence-b@example.invalid','0','Passport','fence-b','M');
  insert into public.runner_access values(u,a),(u,b);
  insert into public.strava_connections(user_id,generation,status,athlete_id,granted_scopes) values(u,g,'active','900',array['activity:read_all']);
  perform public.strava_attach_runner(u,a); perform public.strava_attach_runner(u,b);
  return jsonb_build_object('u',u,'a',a,'b',b,'g',g);
end $$;
create or replace function pg_temp.fence_batch(r uuid,id text,match text default 'auto_match') returns jsonb language sql as $$
  select jsonb_build_object('runner_id',r,'candidates',jsonb_build_array(jsonb_build_object(
    'activity_id',id,'match_status',match,'reason','race_checks_passed','summary','{}'::jsonb)))
$$;
create or replace function pg_temp.fence_detail(id text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id',id,'activity',jsonb_build_object('id',id,'athleteId','900','sportType','Run','averageHeartrate',150)))
$$;
-- CASE sequential overlap preserves earlier selection and snapshot
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; b uuid:=(f->>'b')::uuid; g uuid:=(f->>'g')::uuid; j jsonb; build uuid;
begin
  perform public.strava_enqueue(u,g,'activity','a',jsonb_build_object('runner_id',a)); j:=public.strava_claim_job();
  perform public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,pg_temp.fence_detail('10'),p_runner_candidates=>jsonb_build_array(pg_temp.fence_batch(a,'10')));
  build:=public.strava_begin_wrapped_snapshot(u,g,a,'10',1);
  perform public.strava_finish_wrapped_snapshot(u,g,a,'10',1,build,'ready','{}');
  perform public.strava_enqueue(u,g,'activity','b',jsonb_build_object('runner_id',b)); j:=public.strava_claim_job();
  perform public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,pg_temp.fence_detail('10'),p_runner_candidates=>jsonb_build_array(pg_temp.fence_batch(b,'10')));
  assert exists(select 1 from public.strava_runner_activities where runner_id=a and activity_id='10'), 'Overlapping B import removed A selection';
  assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and build_id=build and status='ready'), 'Overlapping B import removed A snapshot';
end $$;
-- CASE confirmation returns a recoverable conflict
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; b uuid:=(f->>'b')::uuid; g uuid:=(f->>'g')::uuid;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_store_runner_candidates(u,g,b,pg_temp.fence_batch(b,'10')->'candidates');
  perform public.strava_confirm_runner_activity(u,g,a,'10');
  assert public.strava_confirm_runner_activity(u,g,b,'10')='activity_already_selected', 'Conflict must be recoverable';
end $$;
-- CASE stale shared webhook cannot publish into a replacement attachment
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; b uuid:=(f->>'b')::uuid; g uuid:=(f->>'g')::uuid; j jsonb;
begin
  perform public.strava_enqueue(u,g,'webhook','held','{}'); j:=public.strava_claim_job();
  perform public.strava_detach_runner(u,a); perform public.strava_attach_runner(u,a);
  perform public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,pg_temp.fence_detail('99'),p_runner_candidates=>jsonb_build_array(pg_temp.fence_batch(a,'99'),pg_temp.fence_batch(b,'99')));
  assert not exists(select 1 from public.strava_activity_candidates where user_id=u and activity_id='99'), 'Old webhook repopulated a replaced attachment';
  assert not exists(select 1 from public.strava_activities where user_id=u and activity_id='99');
end $$;
-- CASE stale enqueue cannot attach work to the replacement incarnation
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; g uuid:=(f->>'g')::uuid; incarnation uuid;
begin
  select (to_jsonb(s)->>'attachment_id')::uuid into incarnation from public.strava_runner_attachments s where runner_id=a;
  perform public.strava_detach_runner(u,a); perform public.strava_attach_runner(u,a);
  assert not public.strava_enqueue_runner_backfill(u,g,a,incarnation,1818460799,1818468001), 'Old enqueue accepted a replacement attachment';
  assert not exists(select 1 from public.strava_jobs where user_id=u and payload->>'runner_id'=a::text);
end $$;
-- CASE detach during claimed OAuth retains credentials for revocation
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid;
begin
  delete from public.strava_connections where user_id=u;
  assert public.strava_begin_runner_oauth(u,a,'held-exchange','/wrapped/'||a)='ready';
  perform public.strava_claim_runner_oauth(u,'held-exchange');
  -- Token exchange is outstanding while detach commits.
  perform public.strava_detach_runner(u,a);
  assert public.strava_finish_oauth(u,'held-exchange','{"athlete_id":"900","access_token":"encrypted","refresh_token":"encrypted","expires_at":"2030-01-01T00:00:00Z","scopes":["activity:read_all"]}')='cancelled', 'Detached in-flight OAuth lost its cancellation tombstone';
  assert exists(select 1 from public.strava_connections where user_id=u and status='disconnecting' and refresh_token='encrypted');
  assert exists(select 1 from public.strava_jobs where user_id=u and kind='revoke');
  assert not exists(select 1 from public.strava_runner_attachments where user_id=u);
end $$;
-- CASE negative classification removes only that runner and retains shared detail
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; a uuid:=(f->>'a')::uuid; b uuid:=(f->>'b')::uuid; g uuid:=(f->>'g')::uuid; j jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_store_runner_candidates(u,g,b,pg_temp.fence_batch(b,'10')->'candidates');
  perform public.strava_confirm_runner_activity(u,g,a,'10');
  perform public.strava_enqueue(u,g,'webhook','reclassify','{}'); j:=public.strava_claim_job();
  perform public.strava_commit_runner_job((j->>'id')::uuid,(j->>'lease_id')::uuid,pg_temp.fence_detail('10'),p_runner_candidates=>jsonb_build_array(pg_temp.fence_batch(a,'10','no_match'),pg_temp.fence_batch(b,'10')));
  assert not exists(select 1 from public.strava_activity_candidates where runner_id=a and activity_id='10'), 'Stale A candidate retained';
  assert not exists(select 1 from public.strava_runner_activities where runner_id=a);
  assert exists(select 1 from public.strava_activities where user_id=u and activity_id='10' and activity is not null), 'B detail removed';
  assert exists(select 1 from public.strava_activity_candidates where runner_id=b and activity_id='10');
end $$;
