begin;
create or replace function pg_temp.expect_snapshot_error(statement text, expected_state text) returns void
language plpgsql as $$
begin
  begin execute statement;
  exception when others then if sqlstate=expected_state then return; end if; raise; end;
  raise exception 'Expected SQLSTATE % for %',expected_state,statement;
end $$;
create or replace function pg_temp.expect_snapshot_check_error(statement text, expected_state text) returns void
language plpgsql security definer set search_path='' as $$
begin
  begin execute statement;
  exception when others then if sqlstate=expected_state then return; end if; raise; end;
  raise exception 'Expected SQLSTATE % for %',expected_state,statement;
end $$;

do $$
declare u uuid := gen_random_uuid(); r uuid := gen_random_uuid(); r2 uuid := gen_random_uuid();
  g uuid := gen_random_uuid(); e bigint; c bigint; build uuid; newer uuid; statement text;
begin
  insert into auth.users values(u);
  insert into public.events(name,event_date) values('Snapshot lifecycle','2027-08-17') returning id into e;
  insert into public.categories(event_id,name,distance_km,min_age) values(e,'5K',5,17) returning id into c;
  insert into public.runners(id,category_id,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
    values(r,c,'Snapshot','1990-01-01','M','snapshot1@example.invalid','0','Passport','snap1','M'),
      (r2,c,'Snapshot 2','1990-01-01','M','snapshot2@example.invalid','0','Passport','snap2','M');
  insert into public.runner_access values(u,r),(u,r2);
  insert into public.strava_connections(user_id,generation,status) values(u,g,'active');
  set local role service_role;
  assert public.strava_attach_runner(u,r)='attached';
  assert public.strava_attach_runner(u,r2)='attached';
  assert public.strava_begin_wrapped_snapshot(u,g,r,'race',1) is null, 'No snapshot without exact selection';
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'race','{}'),(u,g,'race2','{}');
  perform public.strava_store_runner_candidates(u,g,r,'[{"activity_id":"race","match_status":"auto_match","reason":"race_checks_passed"}]');
  perform public.strava_store_runner_candidates(u,g,r2,'[{"activity_id":"race","match_status":"auto_match","reason":"race_checks_passed"},{"activity_id":"race2","match_status":"auto_match","reason":"race_checks_passed"}]');
  assert public.strava_select_runner_activity(u,g,r,'race','{}')='selected';
  perform pg_temp.expect_snapshot_error(format('select public.strava_select_runner_activity(%L,%L,%L,''race'',''{}'')',u,g,r2),'23505');
  assert public.strava_select_runner_activity(u,g,r2,'race2','{}')='selected';
  build := public.strava_begin_wrapped_snapshot(u,g,r,'race',1);
  assert build is not null;
  assert (select status='building' and payload is null and error_code is null from public.strava_wrapped_snapshots where runner_id=r);
  perform pg_temp.expect_snapshot_error(format(
    'update public.strava_wrapped_snapshots set status=''failed'',payload=null,error_code=''bypass'' where runner_id=%L',r),'42501');
  perform pg_temp.expect_snapshot_error(format(
    'insert into public.strava_wrapped_snapshots(user_id,generation,runner_id,activity_id,version) values(%L,%L,%L,''bypass'',1)',u,g,r),'42501');
  perform pg_temp.expect_snapshot_error(format(
    'delete from public.strava_wrapped_snapshots where runner_id=%L',r),'42501');
  assert public.strava_finish_wrapped_snapshot(u,g,r,'race',1,build,'ready','{"version":1,"distanceMeters":5000}',null)='ready';
  assert public.strava_finish_wrapped_snapshot(u,g,r,'race',1,build,'failed',null,'projection_failed')='obsolete', 'Terminal builds cannot be overwritten';
  newer := public.strava_begin_wrapped_snapshot(u,g,r,'race',1);
  assert newer<>build;
  assert public.strava_finish_wrapped_snapshot(u,g,r,'race',1,build,'ready','{}',null)='obsolete';
  assert public.strava_finish_wrapped_snapshot(u,g,r,'race',1,newer,'failed',null,'projection_failed')='failed';
  build := public.strava_begin_wrapped_snapshot(u,g,r,'race',1);
  foreach statement in array array[
    'version=0','version=1001','payload=''[]''::jsonb',
    'payload=jsonb_build_object(''text'',repeat(''x'',65537))',
    'status=''ready'',payload=null','status=''failed'',error_code=null',
    'status=''building'',error_code=''unexpected'''
  ] loop
    perform pg_temp.expect_snapshot_check_error(format('update public.strava_wrapped_snapshots set %s where runner_id=%L',statement,r),'23514');
  end loop;
  perform pg_temp.expect_snapshot_error(format('select public.strava_finish_wrapped_snapshot(%L,%L,%L,''race'',1,%L,''building'',null,null)',u,g,r,build),'22023');
  assert public.strava_begin_wrapped_snapshot(u,gen_random_uuid(),r,'race',1) is null;
  assert public.strava_finish_wrapped_snapshot(u,gen_random_uuid(),r,'race',1,build,'ready','{}',null)='obsolete';
  assert public.strava_detach_runner(u,r)='detached';
  assert not exists(select 1 from public.strava_wrapped_snapshots where runner_id=r);
  assert not exists(select 1 from public.strava_activity_candidates where runner_id=r);
  assert not exists(select 1 from public.strava_runner_activities where runner_id=r);
  assert not exists(select 1 from public.strava_live_metrics where runner_id=r);
  assert exists(select 1 from public.strava_runner_activities where runner_id=r2);
  assert public.strava_attach_runner(u,r)='attached';
  -- Reuse the same selection IDs after detach; the old build must remain fenced.
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'race','{}') on conflict do nothing;
  perform public.strava_store_runner_candidates(u,g,r,'[{"activity_id":"race","match_status":"auto_match","reason":"race_checks_passed"}]');
  perform public.strava_select_runner_activity(u,g,r,'race','{}');
  newer := public.strava_begin_wrapped_snapshot(u,g,r,'race',1);
  assert public.strava_finish_wrapped_snapshot(u,g,r,'race',1,build,'ready','{}',null)='obsolete';
  assert public.strava_finish_wrapped_snapshot(u,g,r,'race',1,newer,'ready','{}',null)='ready';
  perform public.strava_store_runner_candidates(u,g,r,'[{"activity_id":"race2","match_status":"auto_match","reason":"race_checks_passed"}]');
  delete from public.strava_runner_activities where runner_id=r2;
  perform public.strava_select_runner_activity(u,g,r,'race2','{}');
  assert not exists(select 1 from public.strava_wrapped_snapshots where runner_id=r), 'Selection replacement cannot retarget old payloads';
  perform public.strava_select_runner_activity(u,g,r,'race','{}');
  build := public.strava_begin_wrapped_snapshot(u,g,r,'race',1);
  -- A detail replacement invalidates the exact selection and its projection.
  update public.strava_activities set activity='{"distanceMeters":5001}' where user_id=u and activity_id='race';
  assert not exists(select 1 from public.strava_wrapped_snapshots where runner_id=r);
  perform public.strava_select_runner_activity(u,g,r2,'race2','{}');
  build := public.strava_begin_wrapped_snapshot(u,g,r2,'race2',1);
  reset role;
  delete from public.runners where id=r2;
  assert not exists(select 1 from public.strava_wrapped_snapshots where runner_id=r2);
  assert not exists(select 1 from public.strava_runner_attachments where runner_id=r2);
  perform public.strava_store_runner_candidates(u,g,r,'[{"activity_id":"race","match_status":"auto_match","reason":"race_checks_passed"}]');
  perform public.strava_select_runner_activity(u,g,r,'race','{}');
  build := public.strava_begin_wrapped_snapshot(u,g,r,'race',1);
  perform public.strava_disconnect(u);
  assert not exists(select 1 from public.strava_wrapped_snapshots where user_id=u);
  assert not exists(select 1 from public.strava_runner_attachments where user_id=u);
  assert public.strava_finish_wrapped_snapshot(u,g,r,'race',1,build,'ready','{}',null)='obsolete';
  -- Reconnect and delete the account while its attachment and projection exist.
  update public.strava_connections set status='active' where user_id=u returning generation into g;
  perform public.strava_attach_runner(u,r);
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'race','{}');
  perform public.strava_store_runner_candidates(u,g,r,'[{"activity_id":"race","match_status":"auto_match","reason":"race_checks_passed"}]');
  perform public.strava_select_runner_activity(u,g,r,'race','{}');
  build := public.strava_begin_wrapped_snapshot(u,g,r,'race',1);
  delete from auth.users where id=u;
  assert not exists(select 1 from public.strava_connections where user_id=u);
  assert not exists(select 1 from public.strava_runner_attachments where user_id=u);
  assert not exists(select 1 from public.strava_wrapped_snapshots where user_id=u);
  assert not exists(select 1 from public.strava_activity_candidates where user_id=u);
  assert not exists(select 1 from public.strava_runner_activities where user_id=u);
  assert not exists(select 1 from public.strava_live_metrics where user_id=u);
end $$;
set local role authenticated;
do $$
begin
  begin
    perform public.strava_attach_runner(gen_random_uuid(),gen_random_uuid());
    raise exception 'Browser roles must not call attachment RPCs';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.strava_wrapped_snapshots;
    raise exception 'Browser roles must not read snapshots';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
