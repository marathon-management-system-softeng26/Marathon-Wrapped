create or replace function public.strava_claim_credentials(p_user uuid, p_kind text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.strava_connections;
begin
  if p_kind not in ('refresh', 'revoke') then
    raise exception 'Invalid operation';
  end if;

  select * into c
  from public.strava_connections
  where user_id = p_user
  for update;

  if c.user_id is null
    or (p_kind = 'refresh' and c.status <> 'active')
    or (p_kind = 'revoke' and c.status <> 'disconnecting')
  then
    return null;
  end if;

  if p_kind='refresh' and c.credentials_uncertain then return null; end if;

  if c.operation_until > now() then
    return jsonb_build_object('busy', true);
  end if;

  -- An abandoned refresh might already have rotated the provider token. Do not repeat it.
  if c.operation_kind = 'refresh' then
    update public.strava_connections
    set status = case when status = 'active' then 'reauth_required' else status end,
        credentials_uncertain = true,
        operation_id = null,
        operation_kind = null,
        operation_until = null
    where user_id = p_user;

    if p_kind = 'refresh' then
      return null;
    end if;
  end if;

  update public.strava_connections
  set operation_id = gen_random_uuid(),
      operation_kind = p_kind,
      operation_until = now() + interval '2 minutes'
  where user_id = p_user
  returning * into c;

  return to_jsonb(c);
end
$$;

create or replace function public.strava_finish_refresh(
  p_user uuid,
  p_operation uuid,
  p_generation uuid,
  p_tokens jsonb default null,
  p_reauth boolean default false,
  p_uncertain boolean default false
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.strava_connections;
begin
  select * into c
  from public.strava_connections
  where user_id = p_user
  for update;

  if p_operation is null or c.operation_id is distinct from p_operation or c.operation_kind is distinct from 'refresh' then
    return false;
  end if;

  -- Disconnect may have won while refresh was in flight. Retain the newest pair only for revocation.
  update public.strava_connections
  set access_token = coalesce(p_tokens->>'access_token', access_token),
      refresh_token = coalesce(p_tokens->>'refresh_token', refresh_token),
      expires_at = coalesce((p_tokens->>'expires_at')::timestamptz, expires_at),
      credentials_uncertain = case
        when p_tokens is not null then false
        else credentials_uncertain or p_uncertain
      end,
      status = case when p_reauth and status = 'active' then 'reauth_required' else status end,
      operation_id = null,
      operation_kind = null,
      operation_until = null
  where user_id = p_user;

  return c.generation = p_generation and c.status = 'active' and not p_reauth;
end
$$;

create or replace function public.strava_finish_project_refresh(p_user uuid,p_operation uuid,p_generation uuid,p_tokens jsonb default null,p_reauth boolean default false,p_uncertain boolean default false,p_job uuid default null,p_lease uuid default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare current_build boolean; finished boolean; c public.strava_connections;
begin
  select * into c from public.strava_connections where user_id=p_user for update;
  perform 1 from public.strava_jobs where id=p_job for update;
  if p_operation is null or c.operation_id is distinct from p_operation or c.operation_kind is distinct from 'refresh' then return false; end if;
  current_build:=public.strava_project_lease_current(p_job,p_lease,p_user);
  -- This exact credential operation owns a potentially rotated token even when
  -- the requesting build has since been replaced. Preserve its token/uncertain
  -- result, but do not propagate reauthorization from a stale project.
  finished:=public.strava_finish_refresh(p_user,p_operation,p_generation,p_tokens,p_reauth and current_build,p_uncertain);
  return finished and current_build;
end $$;
create or replace function public.strava_discard_projection_job(p_job uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.strava_jobs;
begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  perform 1 from public.strava_connections where user_id=j.user_id for update;
  select * into j from public.strava_jobs where id=p_job for update;
  if p_lease is null or j.lease_id is null or j.kind<>'project' or j.status<>'processing' or j.lease_id is distinct from p_lease or j.lease_until is null or j.lease_until<=now() then return false; end if;
  if public.strava_project_lease_current(p_job,p_lease,j.user_id) then
    return public.strava_fail_projection_job(p_job,p_lease,'invalid_projection',null,false);
  end if;
  return public.strava_commit_job_internal(p_job,p_lease);
end $$;

create or replace function public.strava_projection_context_matches(p_user uuid,p_generation uuid,p_context jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  -- Lock exactly the IDs supplied by the coherent read, parents before children.
  -- A concurrent move or deletion is detected by the final context comparison.
  if jsonb_typeof(p_context)<>'array' then return false; end if;
  perform e.id from public.events e where e.id in
    (select (x->>'event_id')::bigint from jsonb_array_elements(p_context) x) order by e.id for share nowait;
  perform cat.id from public.categories cat where cat.id in
    (select (x->>'category_id')::bigint from jsonb_array_elements(p_context) x) order by cat.id for update nowait;
  perform r.id from public.runners r where r.id in
    (select (x->>'runner_id')::uuid from jsonb_array_elements(p_context) x) order by r.id for share nowait;
  perform access.runner_id from public.runner_access access where access.user_id=p_user and access.runner_id in
    (select (x->>'runner_id')::uuid from jsonb_array_elements(p_context) x) order by access.runner_id for share nowait;
  perform race.category_id from public.strava_race_configs race where race.category_id in
    (select (x->>'category_id')::bigint from jsonb_array_elements(p_context) x) order by race.category_id for share nowait;
  return p_context is not null and p_context=public.strava_projection_context(p_user,p_generation);
exception when lock_not_available then return false;
end $$;
create or replace function public.strava_project_lease_current(p_job uuid,p_lease uuid,p_user uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare runner uuid;
begin
  if p_lease is null then return false; end if;
  select (payload->>'runner_id')::uuid into runner from public.strava_jobs where id=p_job and user_id=p_user;
  if runner is null then return false; end if;
  perform 1 from public.runner_access where user_id=p_user and runner_id=runner for key share nowait;
  if not found then return false; end if;
  perform 1 from public.strava_runner_attachments where user_id=p_user and runner_id=runner and status='active' for share nowait;
  if not found then return false; end if;
  return exists(select 1 from public.strava_jobs j join public.strava_connections c on c.user_id=j.user_id
    join public.strava_runner_activities s on s.user_id=j.user_id and s.generation=j.generation and s.runner_id=runner and s.activity_id=j.payload->>'activity_id'
    join public.strava_wrapped_snapshots w on w.user_id=s.user_id and w.generation=s.generation and w.runner_id=s.runner_id and w.activity_id=s.activity_id
      and w.version::text=j.payload->>'version' and w.build_id::text=j.payload->>'build_id' and w.status='building'
    join public.strava_runner_attachments a on a.user_id=s.user_id and a.generation=s.generation and a.runner_id=s.runner_id and a.status='active'
    where j.id=p_job and j.user_id=p_user and j.kind='project' and j.status='processing' and j.lease_id=p_lease and j.lease_until>now()
      and c.status='active' and c.generation=j.generation and a.attachment_id::text=j.attachment_fences->>s.runner_id::text
      and public.strava_runner_opted_in(j.user_id,j.generation,s.runner_id));
exception when lock_not_available then return false;
end $$;
create function public.strava_finish_project_refresh_v2(p_user uuid,p_operation uuid,p_generation uuid,p_tokens jsonb default null,p_reauth boolean default false,p_uncertain boolean default false,p_job uuid default null,p_lease uuid default null,p_revoked boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare current_build boolean; finished boolean; c public.strava_connections;
begin
  select * into c from public.strava_connections where user_id=p_user for update;
  perform 1 from public.strava_jobs where id=p_job for update;
  if p_operation is null or c.operation_id is distinct from p_operation or c.operation_kind is distinct from 'refresh' then return false; end if;
  current_build:=public.strava_project_lease_current(p_job,p_lease,p_user);
  finished:=public.strava_finish_refresh(p_user,p_operation,p_generation,p_tokens,p_reauth and current_build and not p_revoked,p_uncertain);
  if current_build and p_revoked then return public.strava_provider_revoked(p_user,p_generation); end if;
  return finished and current_build;
end $$;
revoke all on function public.strava_finish_project_refresh_v2(uuid,uuid,uuid,jsonb,boolean,boolean,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.strava_finish_project_refresh_v2(uuid,uuid,uuid,jsonb,boolean,boolean,uuid,uuid,boolean) to service_role;

create or replace function public.strava_fail_projection_job(p_job uuid,p_lease uuid,p_error text,p_delay integer,p_reauth boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.strava_jobs; c public.strava_connections; incarnation text;
begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  select * into c from public.strava_connections where user_id=j.user_id for update;
  select * into j from public.strava_jobs where id=p_job for update;
  if j.id is null or j.kind<>'project' or j.status<>'processing' or j.lease_id is distinct from p_lease
    or p_lease is null or j.lease_until is null or j.lease_until<=now() or c.status<>'active' or c.generation<>j.generation then return false; end if;
  if not public.strava_project_lease_current(p_job,p_lease,j.user_id) then return false; end if;
  select attachment_id::text into incarnation from public.strava_runner_attachments
    where user_id=j.user_id and generation=j.generation and runner_id::text=j.payload->>'runner_id' and status='active';
  if incarnation is distinct from j.attachment_fences->>(j.payload->>'runner_id') or incarnation is null
    or not exists(select 1 from public.strava_runner_activities s join public.strava_wrapped_snapshots w
      on w.user_id=s.user_id and w.generation=s.generation and w.runner_id=s.runner_id and w.activity_id=s.activity_id
      where s.user_id=j.user_id and s.generation=j.generation and s.runner_id::text=j.payload->>'runner_id'
        and s.activity_id=j.payload->>'activity_id' and w.version::text=j.payload->>'version'
        and w.build_id::text=j.payload->>'build_id' and w.status='building') then
    return public.strava_commit_job_internal(p_job,p_lease);
  end if;
  if p_error='authorization_revoked' and public.strava_provider_revoked(j.user_id,j.generation) then return true; end if;
  if incarnation is not distinct from j.attachment_fences->>(j.payload->>'runner_id') and incarnation is not null
    and (p_delay is null or j.attempts>=8) then
    perform public.strava_finish_wrapped_snapshot(j.user_id,j.generation,(j.payload->>'runner_id')::uuid,
      j.payload->>'activity_id',(j.payload->>'version')::integer,(j.payload->>'build_id')::uuid,'failed',null,p_error);
  end if;
  return public.strava_commit_job_internal(p_job,p_lease,p_error=>p_error,p_delay=>p_delay,p_reauth=>p_reauth);
end $$;

create schema if not exists strava_projection_private;
revoke all on schema strava_projection_private from public,anon,authenticated,service_role;
create table strava_projection_private.gates(pid integer not null,tx bigint not null,job uuid not null,depth integer not null,primary key(pid,tx,job));
revoke all on strava_projection_private.gates from public,anon,authenticated,service_role;
create function strava_projection_private.enter_gate(p_job uuid) returns void language sql security definer set search_path='' as $$
  insert into strava_projection_private.gates values(pg_backend_pid(),txid_current(),coalesce(p_job,'00000000-0000-0000-0000-000000000000'::uuid),1)
  on conflict(pid,tx,job) do update set depth=strava_projection_private.gates.depth+1
$$;
create function strava_projection_private.exit_gate(p_job uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  update strava_projection_private.gates set depth=depth-1 where pid=pg_backend_pid() and tx=txid_current() and job=coalesce(p_job,'00000000-0000-0000-0000-000000000000'::uuid);
  delete from strava_projection_private.gates where pid=pg_backend_pid() and tx=txid_current() and job=coalesce(p_job,'00000000-0000-0000-0000-000000000000'::uuid) and depth=0;
end $$;
create function strava_projection_private.allowed(p_job uuid) returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from strava_projection_private.gates where pid=pg_backend_pid() and tx=txid_current() and job in (p_job,'00000000-0000-0000-0000-000000000000'::uuid) and depth>0)
$$;
revoke all on all functions in schema strava_projection_private from public,anon,authenticated,service_role;
create function strava_projection_private.guard_job() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.kind='project' and old.status='processing' and new.status in ('pending','failed','complete') and not strava_projection_private.allowed(old.id) then
    raise exception 'project mutation requires fenced worker' using errcode='42501';
  end if;
  return new;
end $$;
create function strava_projection_private.guard_connection() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if ((new.status='reauth_required' and old.status is distinct from new.status) or new.rate_limited_until is distinct from old.rate_limited_until or (new.credentials_uncertain and not old.credentials_uncertain))
    and exists(select 1 from public.strava_jobs j where j.user_id=old.user_id and j.kind='project' and j.status='processing' and not strava_projection_private.allowed(j.id)) then
    raise exception 'project connection mutation requires fenced worker' using errcode='42501';
  end if;
  return new;
end $$;
create trigger strava_projection_guard_job before update on public.strava_jobs for each row execute function strava_projection_private.guard_job();
create trigger strava_projection_guard_connection before update on public.strava_connections for each row execute function strava_projection_private.guard_connection();

alter function public.strava_claim_projection_aware_job() rename to strava_claim_projection_aware_job_guarded_impl;
revoke all on function public.strava_claim_projection_aware_job_guarded_impl() from public,anon,authenticated,service_role;
create function public.strava_claim_projection_aware_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform strava_projection_private.enter_gate(null);
  result:=public.strava_claim_projection_aware_job_guarded_impl();
  perform strava_projection_private.exit_gate(null);
  return result;
end $$;
revoke all on function public.strava_claim_projection_aware_job() from public,anon,authenticated;
grant execute on function public.strava_claim_projection_aware_job() to service_role;
alter function public.strava_commit_job(uuid,uuid,jsonb,text,integer,boolean,jsonb,jsonb) rename to strava_commit_job_guarded_impl;
revoke all on function public.strava_commit_job_guarded_impl(uuid,uuid,jsonb,text,integer,boolean,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.strava_commit_job(p_job uuid,p_lease uuid,p_activities jsonb default '[]',p_error text default null,p_delay integer default null,p_reauth boolean default false,p_continuation jsonb default null,p_discoveries jsonb default '[]') returns boolean language plpgsql security definer set search_path='' as $$
declare result boolean;
begin
  perform strava_projection_private.enter_gate(p_job);
  result:=public.strava_commit_job_guarded_impl(p_job,p_lease,p_activities,p_error,p_delay,p_reauth,p_continuation,p_discoveries);
  perform strava_projection_private.exit_gate(p_job);
  return result;
end $$;
revoke all on function public.strava_commit_job(uuid,uuid,jsonb,text,integer,boolean,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.strava_commit_job(uuid,uuid,jsonb,text,integer,boolean,jsonb,jsonb) to service_role;
alter function public.strava_retry_projection_attachments(uuid,uuid) rename to strava_retry_projection_attachments_guarded_impl;
revoke all on function public.strava_retry_projection_attachments_guarded_impl(uuid,uuid) from public,anon,authenticated,service_role;
create function public.strava_retry_projection_attachments(p_job uuid,p_lease uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare result boolean;
begin
  perform strava_projection_private.enter_gate(p_job);
  result:=public.strava_retry_projection_attachments_guarded_impl(p_job,p_lease);
  perform strava_projection_private.exit_gate(p_job);
  return result;
end $$;
revoke all on function public.strava_retry_projection_attachments(uuid,uuid) from public,anon,authenticated;
grant execute on function public.strava_retry_projection_attachments(uuid,uuid) to service_role;
alter function public.strava_fail_projection_job(uuid,uuid,text,integer,boolean) rename to strava_fail_projection_job_guarded_impl;
revoke all on function public.strava_fail_projection_job_guarded_impl(uuid,uuid,text,integer,boolean) from public,anon,authenticated,service_role;
create function public.strava_fail_projection_job(p_job uuid,p_lease uuid,p_error text,p_delay integer,p_reauth boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare result boolean;
begin
  perform strava_projection_private.enter_gate(p_job);
  result:=public.strava_fail_projection_job_guarded_impl(p_job,p_lease,p_error,p_delay,p_reauth);
  perform strava_projection_private.exit_gate(p_job);
  return result;
end $$;
revoke all on function public.strava_fail_projection_job(uuid,uuid,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.strava_fail_projection_job(uuid,uuid,text,integer,boolean) to service_role;
alter function public.strava_discard_projection_job(uuid,uuid) rename to strava_discard_projection_job_guarded_impl;
revoke all on function public.strava_discard_projection_job_guarded_impl(uuid,uuid) from public,anon,authenticated,service_role;
create function public.strava_discard_projection_job(p_job uuid,p_lease uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare result boolean;
begin
  perform strava_projection_private.enter_gate(p_job);
  result:=public.strava_discard_projection_job_guarded_impl(p_job,p_lease);
  perform strava_projection_private.exit_gate(p_job);
  return result;
end $$;
revoke all on function public.strava_discard_projection_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.strava_discard_projection_job(uuid,uuid) to service_role;
alter function public.strava_commit_projection_fenced(uuid,uuid,jsonb,text,jsonb) rename to strava_commit_projection_fenced_guarded_impl;
revoke all on function public.strava_commit_projection_fenced_guarded_impl(uuid,uuid,jsonb,text,jsonb) from public,anon,authenticated,service_role;
create function public.strava_commit_projection_fenced(p_job uuid,p_lease uuid,p_payload jsonb,p_error text,p_context jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare result boolean;
begin
  perform strava_projection_private.enter_gate(p_job);
  result:=public.strava_commit_projection_fenced_guarded_impl(p_job,p_lease,p_payload,p_error,p_context);
  perform strava_projection_private.exit_gate(p_job);
  return result;
end $$;
revoke all on function public.strava_commit_projection_fenced(uuid,uuid,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.strava_commit_projection_fenced(uuid,uuid,jsonb,text,jsonb) to service_role;
alter function public.strava_commit_projection_refresh_fenced(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) rename to strava_commit_projection_refresh_fenced_guarded_impl;
revoke all on function public.strava_commit_projection_refresh_fenced_guarded_impl(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.strava_commit_projection_refresh_fenced(p_job uuid,p_lease uuid,p_activities jsonb,p_continuation jsonb,p_discoveries jsonb,p_runner_candidates jsonb,p_context jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare result boolean;
begin
  perform strava_projection_private.enter_gate(p_job);
  result:=public.strava_commit_projection_refresh_fenced_guarded_impl(p_job,p_lease,p_activities,p_continuation,p_discoveries,p_runner_candidates,p_context);
  perform strava_projection_private.exit_gate(p_job);
  return result;
end $$;
revoke all on function public.strava_commit_projection_refresh_fenced(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.strava_commit_projection_refresh_fenced(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
alter function public.strava_claim_project_credentials(uuid,text,uuid,uuid) rename to strava_claim_project_credentials_guarded_impl;
revoke all on function public.strava_claim_project_credentials_guarded_impl(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
create function public.strava_claim_project_credentials(p_user uuid,p_kind text,p_job uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform strava_projection_private.enter_gate(p_job);
  result:=public.strava_claim_project_credentials_guarded_impl(p_user,p_kind,p_job,p_lease);
  perform strava_projection_private.exit_gate(p_job);
  return result;
end $$;
revoke all on function public.strava_claim_project_credentials(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.strava_claim_project_credentials(uuid,text,uuid,uuid) to service_role;
alter function public.strava_finish_project_refresh(uuid,uuid,uuid,jsonb,boolean,boolean,uuid,uuid) rename to strava_finish_project_refresh_guarded_impl;
revoke all on function public.strava_finish_project_refresh_guarded_impl(uuid,uuid,uuid,jsonb,boolean,boolean,uuid,uuid) from public,anon,authenticated,service_role;
create function public.strava_finish_project_refresh(p_user uuid,p_operation uuid,p_generation uuid,p_tokens jsonb default null,p_reauth boolean default false,p_uncertain boolean default false,p_job uuid default null,p_lease uuid default null) returns boolean language plpgsql security definer set search_path='' as $$
declare result boolean;
begin
  perform strava_projection_private.enter_gate(p_job);
  result:=public.strava_finish_project_refresh_guarded_impl(p_user,p_operation,p_generation,p_tokens,p_reauth,p_uncertain,p_job,p_lease);
  perform strava_projection_private.exit_gate(p_job);
  return result;
end $$;
revoke all on function public.strava_finish_project_refresh(uuid,uuid,uuid,jsonb,boolean,boolean,uuid,uuid) from public,anon,authenticated;
grant execute on function public.strava_finish_project_refresh(uuid,uuid,uuid,jsonb,boolean,boolean,uuid,uuid) to service_role;
alter function public.strava_finish_project_refresh_v2(uuid,uuid,uuid,jsonb,boolean,boolean,uuid,uuid,boolean) rename to strava_finish_project_refresh_v2_guarded_impl;
revoke all on function public.strava_finish_project_refresh_v2_guarded_impl(uuid,uuid,uuid,jsonb,boolean,boolean,uuid,uuid,boolean) from public,anon,authenticated,service_role;
create function public.strava_finish_project_refresh_v2(p_user uuid,p_operation uuid,p_generation uuid,p_tokens jsonb default null,p_reauth boolean default false,p_uncertain boolean default false,p_job uuid default null,p_lease uuid default null,p_revoked boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
declare result boolean;
begin
  perform strava_projection_private.enter_gate(p_job);
  result:=public.strava_finish_project_refresh_v2_guarded_impl(p_user,p_operation,p_generation,p_tokens,p_reauth,p_uncertain,p_job,p_lease,p_revoked);
  perform strava_projection_private.exit_gate(p_job);
  return result;
end $$;
revoke all on function public.strava_finish_project_refresh_v2(uuid,uuid,uuid,jsonb,boolean,boolean,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.strava_finish_project_refresh_v2(uuid,uuid,uuid,jsonb,boolean,boolean,uuid,uuid,boolean) to service_role;
-- Validate every rewrite performed by the preceding migration. Abort this
-- migration if the expected call sites did not resolve to the private paths.
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.strava_commit_runner_job_before_projection(uuid,uuid,jsonb,jsonb,jsonb,jsonb)',
    'public.strava_retry_projection_attachments_guarded_impl(uuid,uuid)',
    'public.strava_commit_projection_job(uuid,uuid,jsonb,text)',
    'public.strava_commit_projection_refresh_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb)',
    'public.strava_fail_projection_job_guarded_impl(uuid,uuid,text,integer,boolean)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position('public.strava_commit_job_internal(' in definition)=0 or position('public.strava_commit_job(' in definition)>0 then
      raise exception 'projection commit rewrite missing for %',signature;
    end if;
    if signature like '%strava_commit_projection_refresh_job%' and position('public.strava_commit_projection_runner_internal(' in definition)=0 then
      raise exception 'projection runner rewrite missing for %',signature;
    end if;
  end loop;
  definition:=pg_get_functiondef('public.strava_commit_projection_runner_internal(uuid,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
  if position('public.strava_commit_runner_job_before_projection(' in definition)=0 then
    raise exception 'projection runner clone missing expected call';
  end if;
end $$;
do $$
declare definition text; needle text;
begin
  definition:=pg_get_functiondef('public.strava_commit_job_guarded_impl(uuid,uuid,jsonb,text,integer,boolean,jsonb,jsonb)'::regprocedure);
  needle:='if j.status<>''processing'' or j.lease_id is distinct from p_lease';
  if position(needle in definition)=0 then raise exception 'generic lease guard source mismatch'; end if;
  execute replace(definition,needle,'if p_lease is null or j.lease_id is null or j.status<>''processing'' or j.lease_id is distinct from p_lease');
  definition:=pg_get_functiondef('public.strava_commit_job_internal(uuid,uuid,jsonb,text,integer,boolean,jsonb,jsonb)'::regprocedure);
  needle:='or j.lease_id is distinct from p_lease';
  if position(needle in definition)=0 then raise exception 'internal lease guard source mismatch'; end if;
  execute replace(definition,needle,'or p_lease is null or j.lease_id is null or j.lease_until is null or j.lease_id is distinct from p_lease');
end $$;
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.strava_retry_projection_attachments_guarded_impl(uuid,uuid)',
    'public.strava_commit_projection_job(uuid,uuid,jsonb,text)',
    'public.strava_commit_projection_refresh_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb)',
    'public.strava_fail_projection_job_guarded_impl(uuid,uuid,text,integer,boolean)',
    'public.strava_commit_projection_fenced_guarded_impl(uuid,uuid,jsonb,text,jsonb)',
    'public.strava_commit_projection_refresh_fenced_guarded_impl(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position('p_lease is null' in definition)=0 or position('j.lease_until is null' in definition)=0 then
      raise exception 'projection lease rewrite missing for %',signature;
    end if;
  end loop;
end $$;
do $$
declare signature text; definition text; needle text;
begin
  foreach signature in array array[
    'public.strava_begin_wrapped_snapshot(uuid,uuid,uuid,text,integer)',
    'public.strava_finish_wrapped_snapshot(uuid,uuid,uuid,text,integer,uuid,text,jsonb,text)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    needle:='for key share;';
    if position(needle in definition)=0 then raise exception 'snapshot lock source mismatch for %',signature; end if;
    execute replace(definition,needle,'for key share nowait;');
  end loop;
  definition:=pg_get_functiondef('public.strava_backfill_selected_projections()'::regprocedure);
  needle:='for key share of access,s,candidate,detail';
  if position(needle in definition)=0 then raise exception 'backfill lock source mismatch'; end if;
  execute replace(definition,needle,'for key share of access,s,candidate,detail nowait');
end $$;
