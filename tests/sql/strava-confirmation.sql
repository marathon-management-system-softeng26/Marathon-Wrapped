begin;

do $$
declare
  u uuid := gen_random_uuid();
  foreign_user uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  other_runner uuid := gen_random_uuid();
  g uuid := gen_random_uuid();
  e bigint;
  c bigint;
  selected_time timestamptz;
  detail jsonb := '{"id":"10","athleteId":"confirmation-athlete","sportType":"Run","startDate":"2027-08-17T00:15:00Z","distanceMeters":5000,"startLatLng":null,"averageHeartrate":145.5,"maxHeartrate":null,"elevationGainMeters":0,"calories":null,"averageCadence":80.5}';
begin
  insert into auth.users values(u),(foreign_user);
  insert into public.events(name,event_date) values('Confirmation test','2027-08-17') returning id into e;
  insert into public.categories(event_id,name,distance_km,min_age) values(e,'5K',5,17) returning id into c;
  insert into public.runners(id,category_id,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
    values(r,c,'Runner','1990-01-01','M','confirm@example.invalid','0','Passport','confirm','M'),
      (other_runner,c,'Other runner','1990-01-01','M','other@example.invalid','0','Passport','other-confirm','M');
  insert into public.runner_access values(u,r),(u,other_runner);
  insert into public.strava_connections(user_id,generation,status,athlete_id) values(u,g,'active','confirmation-athlete');
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',detail);
  perform public.strava_store_runner_candidates(u,g,r,'[{"activity_id":"10","match_status":"needs_confirmation","reason":"missing_start_location"}]');
  assert public.strava_confirm_runner_activity(u,g,r,'10')='selected', 'Missing GPS can be explicitly confirmed';
  assert (select avg_heartrate=145.5 and max_heartrate is null and elevation_gain_m=0 and calories is null and avg_cadence=80.5
    from public.strava_live_metrics where runner_id=r), 'Derive all five metrics from stored detail, preserving missing, zero and fractional values';
  select selected_at into selected_time from public.strava_runner_activities where runner_id=r;
  assert public.strava_confirm_runner_activity(u,g,r,'10')='selected';
  assert (select count(*)=1 and min(selected_at)=selected_time and min(selection_source)='manual'
    from public.strava_runner_activities where runner_id=r), 'Repeated confirmation is idempotent and manual';
  assert public.strava_confirm_runner_activity(u,g,other_runner,'10')='invalid_candidate', 'Runner-specific candidate ownership';
  assert public.strava_confirm_runner_activity(u,g,r,'unknown')='invalid_candidate';
  assert public.strava_confirm_runner_activity(foreign_user,g,r,'10')='obsolete';
  assert public.strava_confirm_runner_activity(u,gen_random_uuid(),r,'10')='obsolete';

  -- A detail replacement after the browser/API saw the old candidate must use
  -- the new snapshot inside confirmation, never stale pre-lock caller metrics.
  update public.strava_activities set activity=detail||'{"averageHeartrate":null,"calories":222}'::jsonb
    where user_id=u and activity_id='10';
  perform public.strava_store_runner_candidates(u,g,r,'[{"activity_id":"10","match_status":"needs_confirmation","reason":"missing_start_location"}]');
  assert public.strava_confirm_runner_activity(u,g,r,'10')='selected';
  assert (select avg_heartrate is null and calories=222 and max_heartrate is null and elevation_gain_m=0 and avg_cadence=80.5
    from public.strava_live_metrics where runner_id=r), 'Replacement committed before confirmation supplies its own metrics';
  perform public.strava_store_runner_candidates(u,g,r,'[{"activity_id":"10","match_status":"no_match","reason":"wrong_sport"}]');
  assert public.strava_confirm_runner_activity(u,g,r,'10')='invalid_candidate', 'Reclassified detail cannot be confirmed';
  assert not exists(select 1 from public.strava_live_metrics where runner_id=r);

  perform public.strava_store_runner_candidates(u,g,r,'[{"activity_id":"10","match_status":"needs_confirmation","reason":"missing_start_location"}]');
  update public.strava_activities set activity=null where user_id=u and activity_id='10';
  assert public.strava_confirm_runner_activity(u,g,r,'10')='invalid_candidate', 'Deleted detail cannot be confirmed';
  update public.strava_activities set activity=detail||'{"athleteId":"foreign-athlete"}'::jsonb where user_id=u and activity_id='10';
  perform public.strava_store_runner_candidates(u,g,r,'[{"activity_id":"10","match_status":"needs_confirmation","reason":"missing_start_location"}]');
  assert public.strava_confirm_runner_activity(u,g,r,'10')='invalid_candidate', 'Activity identity must match connection';
  update public.strava_activities set activity=detail where user_id=u and activity_id='10';
  perform public.strava_store_runner_candidates(u,g,r,'[{"activity_id":"10","match_status":"needs_confirmation","reason":"missing_start_location"}]');
  delete from public.runner_access where user_id=u and runner_id=r;
  assert public.strava_confirm_runner_activity(u,g,r,'10')='forbidden', 'Ownership removed before confirmation is rechecked';
  insert into public.runner_access values(u,r);
  perform public.strava_store_runner_candidates(u,g,r,'[{"activity_id":"10","match_status":"needs_confirmation","reason":"missing_start_location"}]');
  update public.strava_connections set status='reauth_required' where user_id=u;
  assert public.strava_confirm_runner_activity(u,g,r,'10')='obsolete', 'Current connection must remain active';
  assert not exists(select 1 from public.strava_live_metrics where runner_id=r);

  assert not has_function_privilege('anon','public.strava_confirm_runner_activity(uuid,uuid,uuid,text)','execute');
  assert not has_function_privilege('authenticated','public.strava_confirm_runner_activity(uuid,uuid,uuid,text)','execute');
  assert has_function_privilege('service_role','public.strava_confirm_runner_activity(uuid,uuid,uuid,text)','execute');
end $$;

rollback;
