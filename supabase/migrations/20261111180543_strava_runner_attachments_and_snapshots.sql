-- A connection is shared; explicit consent and all derived state remain runner-scoped.
create table public.strava_runner_attachments (
  user_id uuid not null,
  generation uuid not null,
  runner_id uuid not null,
  status text not null default 'active' check (status = 'active'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, generation, runner_id),
  foreign key (user_id, generation) references public.strava_connections(user_id, generation) on delete cascade,
  foreign key (user_id, runner_id) references public.runner_access(user_id, runner_id) on delete cascade
);
create index strava_attachments_owner on public.strava_runner_attachments(user_id, runner_id);
create index strava_attachments_runner on public.strava_runner_attachments(runner_id);

-- Upgrade only completed, current, explicitly runner-bound grants. Callback expiry
-- does not expire consent. DISTINCT handles repeated successful callback records.
insert into public.strava_runner_attachments(user_id, generation, runner_id)
select distinct a.user_id, a.generation, a.runner_id
from public.strava_oauth_attempts a
join public.strava_connections c on c.user_id=a.user_id and c.generation=a.generation
join public.runner_access r on r.user_id=a.user_id and r.runner_id=a.runner_id
where a.status='connected' and c.status='active';

alter table public.strava_activity_candidates add constraint strava_candidate_attachment
  foreign key (user_id, generation, runner_id)
  references public.strava_runner_attachments(user_id, generation, runner_id) on delete cascade;
-- NULL means no selection if that state is introduced later. It must never claim
-- the shared activity slot; a partial index gives deterministic NULL semantics.
create unique index strava_selected_activity_once
  on public.strava_runner_activities(user_id, generation, activity_id) where activity_id is not null;
create index strava_selection_candidate on public.strava_runner_activities(user_id, generation, runner_id, activity_id);

create table public.strava_wrapped_snapshots (
  user_id uuid not null,
  generation uuid not null,
  runner_id uuid not null,
  activity_id text not null check (length(activity_id) between 1 and 255),
  version integer not null check (version between 1 and 1000),
  status text not null default 'building' check (status in ('building','ready','failed')),
  payload jsonb check (jsonb_typeof(payload)='object' and octet_length(payload::text)<=65536),
  error_code text check (error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  -- A generation alone cannot fence detach/re-attach or replacement builds.
  build_id uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  primary key (user_id, generation, runner_id, activity_id, version),
  foreign key (user_id, generation, runner_id)
    references public.strava_runner_attachments(user_id, generation, runner_id) on delete cascade,
  foreign key (runner_id, user_id, generation, activity_id)
    references public.strava_runner_activities(runner_id, user_id, generation, activity_id) on delete cascade,
  check (
    (status='building' and payload is null and error_code is null)
    or (status='ready' and payload is not null and error_code is null)
    or (status='failed' and payload is null and error_code is not null)
  )
);
create index strava_snapshots_selection on public.strava_wrapped_snapshots(runner_id, user_id, generation, activity_id);

alter table public.strava_jobs drop constraint strava_jobs_kind_check;
alter table public.strava_jobs add constraint strava_jobs_kind_check
  check (kind in ('webhook','activity','backfill','revoke','project'));

create or replace function public.strava_runner_opted_in(p_user uuid,p_generation uuid,p_runner uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.strava_runner_attachments a
    join public.strava_connections c on c.user_id=a.user_id and c.generation=a.generation
    join public.runner_access r on r.user_id=a.user_id and r.runner_id=a.runner_id
    where a.user_id=p_user and a.generation=p_generation and a.runner_id=p_runner
      and a.status='active' and c.status='active')
$$;

create function public.strava_attach_runner(p_user uuid,p_runner uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare c public.strava_connections;
begin
  select * into c from public.strava_connections where user_id=p_user for update;
  perform 1 from public.runner_access where user_id=p_user and runner_id=p_runner for key share;
  if not found then return 'forbidden'; end if;
  if c.user_id is null or c.status<>'active' then return 'connection_required'; end if;
  insert into public.strava_runner_attachments(user_id,generation,runner_id)
    values(p_user,c.generation,p_runner) on conflict do nothing;
  return 'attached';
end $$;

create function public.strava_detach_runner(p_user uuid,p_runner uuid)
returns text language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.strava_connections where user_id=p_user for update;
  perform 1 from public.runner_access where user_id=p_user and runner_id=p_runner for key share;
  if not found then return 'forbidden'; end if;
  delete from public.strava_runner_attachments where user_id=p_user and runner_id=p_runner;
  -- A stale callback must not restore a removed opt-in. Other runners' queued
  -- work and connection credentials remain intact.
  delete from public.strava_oauth_attempts where user_id=p_user and runner_id=p_runner;
  delete from public.strava_jobs where user_id=p_user and payload->>'runner_id'=p_runner::text;
  delete from public.strava_activities a where a.user_id=p_user and not exists(
    select 1 from public.strava_activity_candidates c where c.user_id=a.user_id
      and c.generation=a.generation and c.activity_id=a.activity_id);
  return 'detached';
end $$;

-- Keep the existing OAuth completion API usable throughout rollout. Only a new
-- successful runner-bound attempt creates consent; replaying a terminal attempt
-- does not re-create a detached attachment.
create function public.strava_attach_completed_oauth() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.status='connected' and new.runner_id is not null then
    if tg_op='UPDATE' then
      if old.status='connected' and old.generation=new.generation then return new; end if;
    end if;
    perform 1 from public.strava_connections
      where user_id=new.user_id and generation=new.generation and status='active' for update;
    if found then perform public.strava_attach_runner(new.user_id,new.runner_id); end if;
  end if;
  return new;
end $$;
create trigger strava_attach_completed_oauth after insert or update of status,generation on public.strava_oauth_attempts
  for each row execute function public.strava_attach_completed_oauth();

-- Connection row locks serialize attach/detach, selection and snapshot completion.
-- Clear children BEFORE changing the generation referenced by their foreign keys.
create or replace function public.strava_cleanup_runner_generation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.generation is distinct from old.generation or new.status<>'active' then
    delete from public.strava_runner_attachments where user_id=old.user_id;
    delete from public.strava_activity_candidates where user_id=old.user_id;
  end if;
  return new;
end $$;

create function public.strava_cleanup_wrapped_selection() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if (new.user_id,new.generation,new.activity_id) is distinct from (old.user_id,old.generation,old.activity_id) then
    delete from public.strava_wrapped_snapshots where user_id=old.user_id and generation=old.generation and runner_id=old.runner_id;
  end if;
  return new;
end $$;
create trigger strava_cleanup_wrapped_selection before update on public.strava_runner_activities
  for each row execute function public.strava_cleanup_wrapped_selection();

-- Returns a fresh build fence, or NULL if ownership/attachment/selection is stale.
-- Rebuilding a failed/ready snapshot clears its previous payload atomically.
create function public.strava_begin_wrapped_snapshot(
  p_user uuid,p_generation uuid,p_runner uuid,p_activity text,p_version integer
) returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
  perform 1 from public.strava_connections where user_id=p_user and generation=p_generation and status='active' for update;
  if not found then return null; end if;
  perform 1 from public.runner_access where user_id=p_user and runner_id=p_runner for key share;
  if not found or not public.strava_runner_opted_in(p_user,p_generation,p_runner) then return null; end if;
  perform 1 from public.strava_runner_activities where user_id=p_user and generation=p_generation
    and runner_id=p_runner and activity_id=p_activity for key share;
  if not found then return null; end if;
  insert into public.strava_wrapped_snapshots(user_id,generation,runner_id,activity_id,version)
    values(p_user,p_generation,p_runner,p_activity,p_version)
    on conflict(user_id,generation,runner_id,activity_id,version) do update
      set status='building',payload=null,error_code=null,build_id=gen_random_uuid(),updated_at=now()
    returning build_id into result;
  return result;
end $$;

create function public.strava_finish_wrapped_snapshot(
  p_user uuid,p_generation uuid,p_runner uuid,p_activity text,p_version integer,p_build uuid,
  p_status text,p_payload jsonb default null,p_error text default null
) returns text language plpgsql security invoker set search_path='' as $$
begin
  if p_status is null or p_status not in ('ready','failed') then
    raise exception 'Invalid snapshot transition' using errcode='22023';
  end if;
  perform 1 from public.strava_connections where user_id=p_user and generation=p_generation and status='active' for update;
  if not found then return 'obsolete'; end if;
  perform 1 from public.runner_access where user_id=p_user and runner_id=p_runner for key share;
  if not found or not public.strava_runner_opted_in(p_user,p_generation,p_runner) then return 'obsolete'; end if;
  perform 1 from public.strava_runner_activities where user_id=p_user and generation=p_generation
    and runner_id=p_runner and activity_id=p_activity for key share;
  if not found then return 'obsolete'; end if;
  update public.strava_wrapped_snapshots set status=p_status,payload=p_payload,error_code=p_error,updated_at=now()
    where user_id=p_user and generation=p_generation and runner_id=p_runner and activity_id=p_activity
      and version=p_version and build_id=p_build and status='building';
  if not found then return 'obsolete'; end if;
  return p_status;
end $$;

-- All access is through the authenticated server boundary; no browser policies
-- or grants. JSON projection validation/minimization happens before this boundary.
alter table public.strava_runner_attachments enable row level security;
alter table public.strava_wrapped_snapshots enable row level security;
revoke all on public.strava_runner_attachments,public.strava_wrapped_snapshots from public,anon,authenticated;
grant select,insert,update,delete on public.strava_runner_attachments,public.strava_wrapped_snapshots to service_role;
revoke all on function public.strava_attach_runner(uuid,uuid),public.strava_detach_runner(uuid,uuid),
  public.strava_attach_completed_oauth(),public.strava_cleanup_wrapped_selection(),
  public.strava_begin_wrapped_snapshot(uuid,uuid,uuid,text,integer),
  public.strava_finish_wrapped_snapshot(uuid,uuid,uuid,text,integer,uuid,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.strava_attach_runner(uuid,uuid),public.strava_detach_runner(uuid,uuid),
  public.strava_attach_completed_oauth(),public.strava_cleanup_wrapped_selection(),
  public.strava_begin_wrapped_snapshot(uuid,uuid,uuid,text,integer),
  public.strava_finish_wrapped_snapshot(uuid,uuid,uuid,text,integer,uuid,text,jsonb,text)
  to service_role;
