-- Seed pre-fix fan-out before the new migration, then verify its data cleanup.
create temporary table scope_upgrade_fixture(u uuid,r uuid,other_runner uuid,g uuid,e bigint);
do $$
declare
  u uuid := gen_random_uuid(); r uuid := gen_random_uuid(); other_runner uuid := gen_random_uuid();
  g uuid := gen_random_uuid(); e bigint; c bigint;
begin
  insert into auth.users values(u);
  insert into public.events(name,event_date) values('Scope upgrade','2027-08-17') returning id into e;
  insert into public.categories(event_id,name,distance_km,min_age) values(e,'5K',5,17) returning id into c;
  insert into public.runners(id,category_id,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
    values(r,c,'Opted-in runner','1990-01-01','M','upgrade1@example.invalid','0','Passport','upgrade1','M'),
      (other_runner,c,'Unselected runner','1990-01-01','M','upgrade2@example.invalid','0','Passport','upgrade2','M');
  insert into public.runner_access values(u,r),(u,other_runner);
  insert into public.strava_connections(user_id,generation,status,athlete_id) values(u,g,'active','upgrade-athlete');
  insert into public.strava_oauth_attempts(state_hash,user_id,generation,status,runner_id,return_path)
    values('upgrade-scope',u,g,'connected',r,'/wrapped/'||r::text);
  insert into public.strava_activities(user_id,generation,activity_id,activity)
    values(u,g,'race','{"calories":100}'),(u,g,'ordinary-workout','{"calories":999,"startLatLng":[1,2]}');
  perform public.strava_store_runner_candidates(u,g,r,'[{"activity_id":"race","match_status":"auto_match","reason":"race_checks_passed"}]');
  perform public.strava_store_runner_candidates(u,g,other_runner,'[{"activity_id":"race","match_status":"auto_match","reason":"race_checks_passed"}]');
  perform public.strava_select_runner_activity(u,g,r,'race','{"calories":100}');
  perform public.strava_select_runner_activity(u,g,other_runner,'race','{"calories":100}');
  insert into public.strava_metrics(runner_id,calories,data_source) values(other_runner,123,'demo');
  insert into scope_upgrade_fixture values(u,r,other_runner,g,e);
end $$;

create function pg_temp.verify_strava_scope_upgrade() returns void language plpgsql as $$
declare fixture scope_upgrade_fixture;
begin
  select * into fixture from scope_upgrade_fixture;
  assert exists(select 1 from public.strava_live_metrics where runner_id=fixture.r and calories=100), 'Upgrade retains the opted-in selection';
  assert not exists(select 1 from public.strava_live_metrics where runner_id=fixture.other_runner), 'Upgrade removes accidental runner enrichment';
  assert (select count(*) from public.strava_activities where user_id=fixture.u)=1, 'Upgrade removes unrelated private details';
  assert exists(select 1 from public.strava_activities where user_id=fixture.u and activity_id='race');
  assert exists(select 1 from public.strava_metrics where runner_id=fixture.other_runner and calories=123 and data_source='demo');
  delete from auth.users where id=fixture.u;
  delete from public.events where id=fixture.e;
end $$;
