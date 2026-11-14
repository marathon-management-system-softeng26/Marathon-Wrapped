-- PGlite has one connection. Inject SQLSTATE 55P03 at each real NOWAIT site;
-- this exercises its exception handler and callers, not concurrent scheduling.
-- CASE access and attachment contention stay retryable
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid;
  j jsonb; original text; needle text; outcome jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  original:=pg_get_functiondef('public.strava_project_lease_current(uuid,uuid,uuid)'::regprocedure);
  foreach needle in array array[
    'perform 1 from public.runner_access where user_id=p_user and runner_id=runner for key share nowait;',
    'perform 1 from public.strava_runner_attachments where user_id=p_user and runner_id=runner and status=''active'' for share nowait;'
  ] loop
    assert position(needle in original)>0, 'fault injection site missing';
    execute replace(original,needle,'raise exception ''injected ownership contention'' using errcode=''55P03'';');
    j:=public.strava_claim_projection_aware_job();
    outcome:=public.strava_claim_project_credentials(u,'refresh',(j->>'id')::uuid,(j->>'lease_id')::uuid);
    assert outcome='{"busy":true}'::jsonb, 'NOWAIT must produce retryable credential outcome';
    assert exists(select 1 from public.strava_connections where user_id=u and status='active' and operation_id is null and not credentials_uncertain and rate_limited_until is null);
    -- Even an already received provider failure cannot revoke while ownership is unknown.
    assert public.strava_fail_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid,'authorization_revoked',null,true);
    assert exists(select 1 from public.strava_connections where user_id=u and status='active' and rate_limited_until is null);
    assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='pending' and lease_id is null and last_error='connection_busy'), 'contention must release lease for retry';
    assert exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and status='building');
    update public.strava_jobs set available_at=now() where id=(j->>'id')::uuid;
    j:=public.strava_claim_projection_aware_job();
    assert public.strava_discard_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid);
    assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='pending' and lease_id is null), 'discard must retry contention instead of acknowledging current work';
    update public.strava_jobs set available_at=now() where id=(j->>'id')::uuid;
    execute original;
  end loop;
end $$;

-- CASE obsolete credential claim has its own outcome
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j jsonb;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity_and_project(u,g,a,'10'); j:=public.strava_claim_projection_aware_job();
  perform public.strava_enqueue_projection(u,g,a,'10');
  assert public.strava_claim_project_credentials(u,'refresh',(j->>'id')::uuid,(j->>'lease_id')::uuid)='{"obsolete":true}'::jsonb;
  assert public.strava_discard_projection_job((j->>'id')::uuid,(j->>'lease_id')::uuid);
  assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='complete' and lease_id is null);
  assert public.strava_claim_projection_aware_job() is not null;
end $$;

-- CASE refresh contention preserves rotated tokens without revocation
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid;
  j jsonb; claim jsonb; original text; needle text; revoked boolean;
begin
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity_and_project(u,g,a,'10'); j:=public.strava_claim_projection_aware_job();
  original:=pg_get_functiondef('public.strava_project_lease_current(uuid,uuid,uuid)'::regprocedure);
  needle:='perform 1 from public.runner_access where user_id=p_user and runner_id=runner for key share nowait;';
  foreach revoked in array array[false,true] loop
    claim:=public.strava_claim_project_credentials(u,'refresh',(j->>'id')::uuid,(j->>'lease_id')::uuid);
    execute replace(original,needle,'raise exception ''injected ownership contention'' using errcode=''55P03'';');
    assert public.strava_finish_project_refresh_v2(u,(claim->>'operation_id')::uuid,g,
      case when revoked then null else '{"access_token":"rotated-access","refresh_token":"rotated-refresh"}'::jsonb end,
      false,false,(j->>'id')::uuid,(j->>'lease_id')::uuid,revoked) is null, 'completion contention must stay distinct';
    assert exists(select 1 from public.strava_connections where user_id=u and status='active' and operation_id is null and refresh_token='rotated-refresh'), 'rotation must persist without connection revocation';
    execute original;
  end loop;
end $$;

-- CASE job-only barrier rolls back preceding connection and data effects
do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid; a uuid:=(f->>'a')::uuid; j jsonb; outcome text;
begin
  assert not exists(select 1 from pg_trigger where tgrelid='public.strava_connections'::regclass and tgname='strava_projection_guard_connection'), 'connection DDL barrier must be removed';
  insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',pg_temp.fence_detail('10')->0->'activity');
  perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
  perform public.strava_confirm_runner_activity_and_project(u,g,a,'10'); j:=public.strava_claim_projection_aware_job();
  foreach outcome in array array['reauth_required','rate_limited','ack'] loop
    begin
      -- Models an old invocation that has already modified the connection/data
      -- before reaching the now-guarded, mandatory job transition.
      update public.strava_connections set status='reauth_required',rate_limited_until=now()+interval '1 minute' where user_id=u;
      delete from public.strava_activities where user_id=u;
      perform public.strava_commit_job_internal((j->>'id')::uuid,(j->>'lease_id')::uuid,
        p_error=>case when outcome='ack' then null else outcome end,p_reauth=>outcome='reauth_required',p_delay=>60);
      raise exception 'unfenced legacy transition accepted';
    exception when insufficient_privilege then null; end;
    assert exists(select 1 from public.strava_connections where user_id=u and status='active' and rate_limited_until is null), 'connection effects must roll back';
    assert exists(select 1 from public.strava_activities where user_id=u and activity_id='10'), 'data effects must roll back';
    assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status='processing');
  end loop;
end $$;
