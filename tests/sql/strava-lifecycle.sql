-- Run after both Strava migrations in an isolated database. All fixtures roll back.
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

rollback;
