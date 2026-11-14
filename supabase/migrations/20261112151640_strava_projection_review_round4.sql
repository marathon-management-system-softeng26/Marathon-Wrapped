-- Ownership checks are three-valued: true=current, false=obsolete, NULL=busy.
-- NULL must never be interpreted as loss of authorization or permission to ack.
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
exception when lock_not_available then return null;
end $$;

create or replace function public.strava_claim_project_credentials_guarded_impl(p_user uuid,p_kind text,p_job uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_build boolean;
begin
  perform 1 from public.strava_connections where user_id=p_user for update;
  perform 1 from public.strava_jobs where id=p_job for update;
  current_build:=public.strava_project_lease_current(p_job,p_lease,p_user);
  if current_build is null then return jsonb_build_object('busy',true); end if;
  if not current_build then return jsonb_build_object('obsolete',true); end if;
  return public.strava_claim_credentials(p_user,p_kind);
end $$;

create or replace function public.strava_fail_projection_job_guarded_impl(p_job uuid,p_lease uuid,p_error text,p_delay integer,p_reauth boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.strava_jobs; current_build boolean;
begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  perform 1 from public.strava_connections where user_id=j.user_id for update;
  select * into j from public.strava_jobs where id=p_job for update;
  if j.id is null or j.kind<>'project' or j.status<>'processing' or j.lease_id is distinct from p_lease
    or p_lease is null or j.lease_until is null or j.lease_until<=now() then return false; end if;
  current_build:=public.strava_project_lease_current(p_job,p_lease,j.user_id);
  if current_build is null then
    -- No ownership decision is possible. Release this lease without touching
    -- credentials, connection or snapshot. Claim's existing retry limit applies.
    update public.strava_jobs set status='pending',lease_id=null,lease_until=null,
      last_error='connection_busy',available_at=now()+interval '3 seconds' where id=j.id;
    return true;
  end if;
  if not current_build then
    update public.strava_jobs set status='complete',lease_id=null,lease_until=null,last_error=null where id=j.id;
    return true;
  end if;
  if p_error='authorization_revoked' and public.strava_provider_revoked(j.user_id,j.generation) then return true; end if;
  if p_delay is null or j.attempts>=8 then
    perform public.strava_finish_wrapped_snapshot(j.user_id,j.generation,(j.payload->>'runner_id')::uuid,
      j.payload->>'activity_id',(j.payload->>'version')::integer,(j.payload->>'build_id')::uuid,'failed',null,p_error);
  end if;
  return public.strava_commit_job_internal(p_job,p_lease,p_error=>p_error,p_delay=>p_delay,p_reauth=>p_reauth);
end $$;

create or replace function public.strava_discard_projection_job_guarded_impl(p_job uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  -- The shared failure path acks obsolete work, retries contention, and fails a
  -- still-current invalid projection. It independently validates the real lease.
  return public.strava_fail_projection_job(p_job,p_lease,'invalid_projection',null,false);
end $$;

-- No new public API or grants: CREATE OR REPLACE retains the service-only RPCs
-- and the private implementations' revoked privileges from round 3.
-- This independent post-barrier scan catches legacy terminal commits that won
-- after round-2 backfill but before installation of the job trigger. No table
-- DDL locks are held here; backfill uses connection-before-job row locks.
select public.strava_backfill_selected_projections();

-- An ineligible selection or a retained build on an inactive connection
-- cannot be requeued. Settle only stranded builds after locking their connection.
do $$
declare connection public.strava_connections;
begin
  for connection in
    select c.* from public.strava_connections c
    where exists(select 1 from public.strava_wrapped_snapshots w
      where w.user_id=c.user_id and w.generation=c.generation and w.status='building')
    order by c.user_id for update
  loop
    update public.strava_wrapped_snapshots w
    set status='failed',error_code='projection_orphaned',updated_at=now()
    where w.user_id=connection.user_id and w.generation=connection.generation and w.status='building'
      and (connection.status<>'active' or not exists(
        select 1 from public.strava_jobs j
        join public.strava_runner_attachments a on a.user_id=w.user_id and a.generation=w.generation
          and a.runner_id=w.runner_id and a.status='active'
        where j.user_id=w.user_id and j.generation=w.generation and j.kind='project'
          and j.payload->>'runner_id'=w.runner_id::text and j.payload->>'activity_id'=w.activity_id
          and j.payload->>'version'=w.version::text and j.payload->>'build_id'=w.build_id::text
          and j.attachment_fences->>w.runner_id::text=a.attachment_id::text
          and (j.status='pending' or (j.status='processing' and j.lease_id is not null and j.lease_until is not null))
      ));
  end loop;
end $$;
