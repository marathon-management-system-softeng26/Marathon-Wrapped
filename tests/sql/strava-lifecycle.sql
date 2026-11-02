-- Run after core/access and all Strava migrations in an isolated database. Fixtures roll back.
begin;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c public.strava_connections;
  job jsonb;
  lease jsonb;
  operation jsonb;
  result text;
  tokens jsonb := jsonb_build_object(
    'athlete_id', '1001',
    'access_token', 'encrypted-access',
    'refresh_token', 'encrypted-refresh',
    'expires_at', now() + interval '1 hour',
    'scopes', jsonb_build_array('activity:read_all')
  );
begin
  insert into auth.users(id) values (a), (b);

  assert public.strava_begin_oauth(a, 'a1') = 'ready';
  assert public.strava_begin_oauth(b, 'b1') = 'ready';
  assert public.strava_claim_oauth(b, 'a1') = 'invalid_state',
    'An account cannot consume another account state';
  assert public.strava_claim_oauth(a, 'a1') = 'claimed';
  assert public.strava_claim_oauth(a, 'a1') = 'processing',
    'Duplicate callback cannot exchange twice';
  assert public.strava_claim_oauth(b, 'b1') = 'claimed';
  assert public.strava_finish_oauth(a, 'a1', tokens) = 'connected';
  assert public.strava_finish_oauth(a, 'a1', tokens) = 'connected',
    'Saving a consumed code result is idempotent';
  assert public.strava_finish_oauth(b, 'b1', tokens) = 'athlete_conflict',
    'One athlete cannot link to two users';
  assert public.strava_begin_oauth(a, 'accidental') = 'already_connected';
  assert not exists (select 1 from public.strava_oauth_attempts where state_hash = 'accidental');

  assert public.strava_begin_oauth(b, 'old-tab') = 'ready';
  assert public.strava_begin_oauth(b, 'new-tab') = 'ready';
  assert public.strava_claim_oauth(b, 'old-tab') = 'cancelled';
  assert public.strava_claim_oauth(b, 'new-tab') = 'claimed';
  assert public.strava_begin_oauth(b, 'during-exchange') = 'in_progress';
  assert public.strava_cancel_oauth(b, 'new-tab') = 'cancelled';
  assert public.strava_finish_oauth(b, 'new-tab', tokens || '{"athlete_id":"1002"}') = 'cancelled';

  select * into c
  from public.strava_connections
  where user_id = b;

  assert c.status = 'disconnecting', 'Cancelled code exchange never activates ingestion';
  assert exists(select 1 from public.strava_jobs where user_id = b and kind = 'revoke');
  assert public.strava_finish_disconnect(b, c.generation);

  assert public.strava_begin_oauth(b, 'expired') = 'ready';

  update public.strava_oauth_attempts
  set expires_at = now() - interval '1 minute'
  where state_hash = 'expired';

  assert public.strava_claim_oauth(b, 'expired') = 'expired';

  select * into c
  from public.strava_connections
  where user_id = a;

  operation := public.strava_claim_credentials(a, 'refresh');

  assert operation->>'operation_id' is not null;
  assert public.strava_claim_credentials(a, 'refresh')->>'busy' = 'true',
    'Concurrent refresh has one owner';
  assert public.strava_finish_refresh(
    a,
    (operation->>'operation_id')::uuid,
    c.generation,
    jsonb_build_object(
      'access_token', 'rotated-access',
      'refresh_token', 'rotated-refresh',
      'expires_at', now() + interval '2 hours'
    )
  );
  assert not public.strava_finish_refresh(
    a,
    (operation->>'operation_id')::uuid,
    c.generation,
    '{"access_token":"stale"}'
  );
  assert (
    select access_token from public.strava_connections where user_id = a
  ) = 'rotated-access';

  assert public.strava_enqueue(a, c.generation, 'webhook', 'event-1', '{}');
  assert public.strava_enqueue(a, c.generation, 'webhook', 'event-1', '{}');
  assert (select count(*) from public.strava_jobs where user_id = a) = 1, 'Enqueue is deduplicated';
  assert public.strava_enqueue(a, c.generation, 'webhook', 'event-2', '{}');

  job := public.strava_claim_job();

  assert job is not null;
  assert public.strava_claim_job() is null,
    'Distinct jobs cannot run concurrently for the same athlete';
  assert not public.strava_commit_job((job->>'id')::uuid, gen_random_uuid()),
    'Only the lease owner may write';
  assert public.strava_commit_job(
    (job->>'id')::uuid,
    (job->>'lease_id')::uuid,
    '[{"id":"999","activity":{"id":"999","polyline":"private"}}]'
  );
  assert exists(
    select 1 from public.strava_activities
    where user_id = a and activity_id = '999'
  );

  lease := public.strava_claim_job();

  update public.strava_jobs
  set lease_until = now() - interval '1 second'
  where id = (lease->>'id')::uuid;

  job := public.strava_claim_job();

  assert job->>'lease_id' <> lease->>'lease_id';
  assert not public.strava_commit_job((lease->>'id')::uuid, (lease->>'lease_id')::uuid),
    'Expired worker cannot resurrect data';
  assert public.strava_commit_job(
    (job->>'id')::uuid,
    (job->>'lease_id')::uuid,
    '[{"id":"999","activity":null}]'
  );
  assert (
    select activity is null from public.strava_activities
    where user_id = a and activity_id = '999'
  );

  assert public.strava_enqueue(a, c.generation, 'webhook', 'in-flight', '{}');

  job := public.strava_claim_job();
  operation := public.strava_claim_credentials(a, 'refresh');
  perform public.strava_disconnect(a);

  assert not exists(select 1 from public.strava_activities where user_id = a);
  assert not public.strava_commit_job(
    (job->>'id')::uuid,
    (job->>'lease_id')::uuid,
    '[{"id":"999","activity":{"polyline":"stale"}}]'
  );
  assert not public.strava_finish_refresh(
    a,
    (operation->>'operation_id')::uuid,
    c.generation,
    jsonb_build_object(
      'access_token', 'final-access',
      'refresh_token', 'final-refresh',
      'expires_at', now() + interval '1 hour'
    )
  );
  assert (
    select refresh_token from public.strava_connections where user_id = a
  ) = 'final-refresh', 'In-flight rotated credentials retained only for revocation';
  assert public.strava_begin_oauth(a, 'too-early') = 'disconnecting';

  select * into c
  from public.strava_connections
  where user_id = a;

  assert public.strava_finish_disconnect(a, c.generation);
  assert public.strava_claim_oauth(a, 'a1') = 'expired',
    'Replaying a callback after disconnect cannot claim connection success';
  assert not exists(select 1 from public.strava_jobs where user_id = a);

  assert public.strava_begin_oauth(a, 'reconnected') = 'ready';
  assert public.strava_claim_oauth(a, 'reconnected') = 'claimed';
  assert public.strava_finish_oauth(a, 'reconnected', tokens) = 'connected';
  assert not public.strava_provider_revoked(a, c.generation),
    'Old deauthorization cannot remove a new connection';
  assert (select status from public.strava_connections where user_id = a) = 'active';

  operation := public.strava_claim_credentials(a, 'refresh');

  update public.strava_connections
  set operation_until = now() - interval '1 second'
  where user_id = a;

  assert public.strava_claim_credentials(a, 'refresh') is null,
    'Crashed refresh is not blindly retried';
  assert (select status from public.strava_connections where user_id = a) = 'reauth_required';
  assert (select credentials_uncertain from public.strava_connections where user_id = a);

  perform public.strava_disconnect(a);

  assert public.strava_begin_oauth(a, 'recover-revoke') = 'ready';
  assert public.strava_claim_oauth(a, 'recover-revoke') = 'claimed';
  assert public.strava_finish_oauth(a, 'recover-revoke', tokens) = 'cancelled',
    'Recovery authorization only obtains credentials for revocation';
  assert (select status from public.strava_connections where user_id = a) = 'disconnecting';
  assert not (select credentials_uncertain from public.strava_connections where user_id = a);

  select * into c
  from public.strava_connections
  where user_id = a;

  assert public.strava_finish_disconnect(a, c.generation);
  assert public.strava_begin_oauth(a, 'cancel-before-exchange') = 'ready';
  assert public.strava_cancel_oauth(a, 'cancel-before-exchange') = 'cancelled';
  assert public.strava_claim_oauth(a, 'cancel-before-exchange') = 'cancelled';

  assert public.strava_begin_oauth(b, 'import-owner') = 'ready';
  assert public.strava_claim_oauth(b, 'import-owner') = 'claimed';
  assert public.strava_finish_oauth(b, 'import-owner', tokens || '{"athlete_id":"1002"}') = 'connected';

  select * into c
  from public.strava_connections
  where user_id = b;

  assert public.strava_enqueue(b, c.generation, 'backfill', 'page-1', '{"after":1,"before":2,"page":1}');

  job := public.strava_claim_job();

  assert public.strava_commit_job(
    (job->>'id')::uuid,
    (job->>'lease_id')::uuid,
    p_continuation => '{"key":"page-2","payload":{"after":1,"before":2,"page":2}}',
    p_discoveries => '[{"object_id":"123","owner_id":"1002"}]'
  );
  assert (
    select count(*) from public.strava_jobs where user_id = b and status = 'pending'
  ) = 2, 'Page continuation and current-detail fetch commit together';
  assert not exists(select 1 from public.strava_activities where user_id = b),
    'Summary pages cannot restore deleted snapshots';

  job := public.strava_claim_job();

  assert public.strava_commit_job(
    (job->>'id')::uuid,
    (job->>'lease_id')::uuid,
    p_error => 'rate_limited',
    p_delay => 900
  );
  assert public.strava_claim_job() is null,
    'Shared provider budget pauses other due ingestion jobs';

  assert not has_table_privilege('anon', 'public.strava_connections', 'select');
  assert not has_table_privilege('authenticated', 'public.strava_activities', 'select');
  assert not has_function_privilege('authenticated', 'public.strava_claim_job()', 'execute');
  assert has_function_privilege('service_role', 'public.strava_claim_job()', 'execute');
end
$$;

-- Catch only the expected database error; a missing rejection must fail the test.
create function pg_temp.expect_error(statement text, expected_state text) returns void
language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise;
  end;
  raise exception 'Expected SQLSTATE % for %', expected_state, statement;
end $$;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  runner uuid := gen_random_uuid();
  foreign_runner uuid := gen_random_uuid();
  event bigint;
  category bigint;
  generation uuid;
  claim jsonb;
  config record;
  statement text;
begin
  insert into auth.users(id) values (a), (b);
  insert into public.events(name, event_date) values ('Storage test', '2027-08-17') returning id into event;
  insert into public.categories(event_id, name, distance_km, min_age)
    values (event, '5K', 5, 17) returning id into category;
  insert into public.runners(id, category_id, name, date_of_birth, gender, email, phone, id_type, id_number, jersey_size)
    values (runner, category, 'Storage A', '1990-01-01', 'M', 'a@example.invalid', '0', 'Passport', 'a', 'M'),
      (foreign_runner, category, 'Storage B', '1990-01-01', 'F', 'b@example.invalid', '0', 'Passport', 'b', 'M');
  insert into public.runner_access values (a, runner), (b, foreign_runner);
  insert into public.strava_race_configs(category_id, start_time_from, start_time_to)
    values (category, '2027-08-17T00:00:00Z', '2027-08-17T02:00:00Z');
  select * into config from public.strava_race_configs where category_id = category;
  assert config.allowed_sport_types = array['Run'] and config.distance_tolerance_m = 500;
  assert config.start_latitude is null and config.start_longitude is null and config.start_radius_m is null;
  perform pg_temp.expect_error(format('insert into public.strava_race_configs(category_id,start_time_from,start_time_to) values (%s,now(),now()+interval ''1 hour'')',category),'23505');
  foreach statement in array array[
    'start_time_to = start_time_from',
    'start_time_from = ''infinity''',
    'start_latitude = 0',
    'start_latitude = 0, start_longitude = 0, start_radius_m = -1',
    'start_latitude = 91, start_longitude = 0, start_radius_m = 100',
    'start_latitude = 0, start_longitude = 181, start_radius_m = 100',
    'start_latitude = 0, start_longitude = 0, start_radius_m = ''Infinity''',
    'distance_tolerance_m = 501',
    'allowed_sport_types = ''{}'''
  ] loop
    perform pg_temp.expect_error(format('update public.strava_race_configs set %s where category_id = %s',statement,category),'23514');
  end loop;
  update public.strava_race_configs set start_latitude = -6.2, start_longitude = 106.8, start_radius_m = 0 where category_id = category;

  perform pg_temp.expect_error(format('select public.strava_begin_runner_oauth(%L,%L,''foreign'',''/wrapped/%s'')',a,foreign_runner,foreign_runner),'42501');
  foreach statement in array array['https://evil.invalid', '//evil.invalid', '/\evil.invalid', '/wrapped/other', '/wrapped/' || runner || '?next=evil', '/wrapped/' || runner || E'\n'] loop
    perform pg_temp.expect_error(format('select public.strava_begin_runner_oauth(%L,%L,''bad-path'',%L)',a,runner,statement),'22023');
  end loop;
  assert public.strava_begin_runner_oauth(a, runner, 'runner-state', '/wrapped/' || runner) = 'ready';
  assert public.strava_claim_runner_oauth(b, 'runner-state')->>'status' = 'invalid_state';
  claim := public.strava_claim_runner_oauth(a, 'runner-state');
  assert claim->>'status' = 'claimed' and claim->>'runner_id' = runner::text;
  assert claim->>'return_path' = '/wrapped/' || runner;
  assert (select count(*) from jsonb_object_keys(claim)) = 4, 'Claim returns only the four safe fields';
  assert public.strava_claim_runner_oauth(a, 'runner-state')->>'status' = 'processing';
  assert public.strava_finish_oauth(a, 'runner-state', jsonb_build_object('athlete_id',a::text,'access_token','encrypted','refresh_token','encrypted','expires_at',now()+interval '1 hour','scopes',array['activity:read_all'])) = 'connected';
  select c.generation into generation from public.strava_connections c where c.user_id = a;
  assert (public.strava_claim_runner_oauth(a, 'runner-state')->>'generation')::uuid = generation;
  insert into public.strava_activities(user_id,generation,activity_id,activity)
    values (a,generation,'one','{}'),(a,generation,'two','{}');
  perform public.strava_store_runner_candidates(a,generation,runner,'[{"activity_id":"one","match_status":"auto_match","reason":"race_checks_passed","summary":{"distanceMeters":5000}},{"activity_id":"two","match_status":"needs_confirmation","reason":"missing_start_location","summary":{}}]');
  perform public.strava_store_runner_candidates(a,generation,runner,'[{"activity_id":"one","match_status":"auto_match","reason":"race_checks_passed","summary":{}}]');
  assert (select count(*) from public.strava_activity_candidates c where c.runner_id = runner) = 2, 'Repeated pages upsert without duplicating or dropping other candidates';
  perform pg_temp.expect_error(format('insert into public.strava_activity_candidates select * from public.strava_activity_candidates where runner_id=%L and activity_id=''one''',runner),'23505');
  -- Generation identity is part of the candidate key even if fixtures deliberately
  -- reuse a UUID across two users with access to the same registration.
  insert into public.runner_access values (b,runner);
  insert into public.strava_connections(user_id,status,generation) values (b,'active',generation);
  insert into public.strava_oauth_attempts(state_hash,user_id,generation,status,runner_id,return_path)
    values('other-owner-scope',b,generation,'connected',runner,'/wrapped/'||runner::text);
  insert into public.strava_activities(user_id,generation,activity_id,activity) values (b,generation,'one','{}');
  perform pg_temp.expect_error(format('insert into public.strava_activity_candidates(user_id,generation,runner_id,activity_id,match_status,reason) values (%L,%L,%L,''one'',''auto_match'',''race_checks_passed'')',b,generation,runner),'23505');
  perform pg_temp.expect_error(format('select public.strava_store_runner_candidates(%L,%L,%L,''[]'')',a,generation,foreign_runner),'42501');
  perform pg_temp.expect_error(format('select public.strava_store_runner_candidates(%L,%L,%L,''[{"activity_id":"missing","match_status":"auto_match","reason":"race_checks_passed","summary":{}}]'')',a,generation,runner),'23503');
  perform pg_temp.expect_error(format('select public.strava_store_runner_candidates(%L,%L,%L,''[]'')',a,gen_random_uuid(),runner),'22023');
  perform pg_temp.expect_error(format('insert into public.strava_activity_candidates(user_id,generation,runner_id,activity_id,match_status,reason) values (%L,%L,%L,''one'',''auto_match'',''race_checks_passed'')',a,generation,foreign_runner),'42501');
  perform pg_temp.expect_error(format('insert into public.strava_activity_candidates(user_id,generation,runner_id,activity_id,match_status,reason) values (%L,%L,%L,''one'',''auto_match'',''race_checks_passed'')',a,gen_random_uuid(),runner),'42501');
  assert public.strava_select_runner_activity(a,generation,foreign_runner,'one','{}') = 'forbidden';
  assert public.strava_select_runner_activity(a,generation,runner,'missing','{}') = 'invalid_candidate';
  assert public.strava_select_runner_activity(a,generation,runner,'one','{"avg_heartrate":140,"max_heartrate":180,"calories":300}') = 'selected';
  assert public.strava_select_runner_activity(a,generation,runner,'one','{"avg_heartrate":140,"max_heartrate":180,"calories":300}') = 'selected';
  assert (select count(*) from public.strava_runner_activities s where s.runner_id=runner) = 1;
  assert (select count(*) from public.strava_live_metrics m where m.runner_id=runner) = 1;
  perform pg_temp.expect_error(format('insert into public.strava_runner_activities select * from public.strava_runner_activities where runner_id=%L',runner),'23505');
  perform pg_temp.expect_error(format('insert into public.strava_live_metrics select * from public.strava_live_metrics where runner_id=%L',runner),'23505');
  perform pg_temp.expect_error(format('select public.strava_select_runner_activity(%L,%L,%L,''two'',''{"calories":-1}'')',a,generation,runner),'23514');
  assert (select activity_id from public.strava_runner_activities s where s.runner_id=runner) = 'one', 'Failed metric replacement rolls selection back';
  assert (select calories from public.strava_live_metrics m where m.runner_id=runner) = 300;
  perform pg_temp.expect_error(format('select public.strava_select_runner_activity(%L,%L,%L,''two'',''{"calories":"300"}'')',a,generation,runner),'22023');
  perform pg_temp.expect_error(format('select public.strava_select_runner_activity(%L,%L,%L,''two'',''{"polyline":"private"}'')',a,generation,runner),'22023');
  assert public.strava_select_runner_activity(a,generation,runner,'two','{"elevation_gain_m":0,"calories":0,"avg_cadence":0}') = 'selected';
  assert (select avg_heartrate is null and max_heartrate is null and calories=0 from public.strava_live_metrics m where m.runner_id=runner), 'Replacement clears metrics absent from the new activity';
  insert into public.strava_metrics(runner_id,avg_heartrate) values (runner,123);
  perform public.strava_clear_live_selection(a,gen_random_uuid());
  assert exists(select 1 from public.strava_live_metrics m where m.runner_id=runner), 'Stale cleanup cannot clear a newer generation';
  perform public.strava_clear_live_selection(a,generation);
  assert not exists(select 1 from public.strava_live_metrics m where m.runner_id=runner);
  assert public.strava_select_runner_activity(a,generation,runner,'one','{}') = 'selected';
  perform public.strava_store_runner_candidates(a,generation,runner,'[{"activity_id":"one","match_status":"no_match","reason":"distance_mismatch","summary":{}}]');
  assert not exists(select 1 from public.strava_live_metrics m where m.runner_id=runner);
  assert public.strava_select_runner_activity(a,generation,runner,'one','{}') = 'invalid_candidate';
  assert public.strava_select_runner_activity(a,generation,runner,'two','{}') = 'selected';
  update public.strava_activities set activity=null where user_id=a and activity_id='two';
  assert not exists(select 1 from public.strava_live_metrics m where m.runner_id=runner), 'Provider deletion clears live metrics';
  perform public.strava_store_runner_candidates(a,generation,runner,'[{"activity_id":"one","match_status":"needs_confirmation","reason":"missing_start_location","summary":{}}]');
  assert public.strava_select_runner_activity(a,generation,runner,'one','{}') = 'selected';
  perform public.strava_disconnect(a);
  assert not exists(select 1 from public.strava_runner_activities s where s.runner_id=runner);
  assert not exists(select 1 from public.strava_live_metrics m where m.runner_id=runner);
  assert not exists(select 1 from public.strava_activity_candidates c where c.runner_id=runner);
  assert (select avg_heartrate from public.strava_metrics m where m.runner_id=runner) = 123, 'Disconnect preserves demo data';
  assert public.strava_select_runner_activity(a,generation,runner,'one','{}') = 'obsolete';
  foreach statement in array array['strava_race_configs','strava_activity_candidates','strava_runner_activities','strava_live_metrics'] loop
    assert not has_table_privilege('anon','public.' || statement,'select');
    assert not has_table_privilege('authenticated','public.' || statement,'insert');
    assert has_table_privilege('service_role','public.' || statement,'select');
  end loop;
  for statement in select oid::regprocedure::text from pg_proc where pronamespace='public'::regnamespace
    and proname in ('strava_begin_runner_oauth','strava_claim_runner_oauth','strava_store_runner_candidates','strava_select_runner_activity','strava_clear_live_selection') loop
    assert not has_function_privilege('authenticated',statement,'execute');
    assert not has_function_privilege('anon',statement,'execute');
    assert has_function_privilege('service_role',statement,'execute');
  end loop;
end $$;

rollback;
