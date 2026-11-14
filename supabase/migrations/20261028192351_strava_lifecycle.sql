-- Legacy rows have neither athlete identity nor consent scopes: require reconnect.
alter table public.strava_connections
  alter column access_token drop not null,
  alter column refresh_token drop not null,
  alter column expires_at drop not null,
  alter column expires_at type timestamptz using expires_at at time zone 'UTC',
  add column athlete_id text unique,
  add column granted_scopes text[] not null default '{}',
  add column status text not null default 'reauth_required'
    check (status in ('active', 'reauth_required', 'disconnecting', 'disconnected')),
  add column generation uuid not null default gen_random_uuid(),
  add column operation_id uuid,
  add column operation_kind text,
  add column operation_until timestamptz,
  add column rate_limited_until timestamptz,
  add column credentials_uncertain boolean not null default false;

update public.strava_connections
set access_token = null,
    refresh_token = null,
    expires_at = null;

create table public.strava_oauth_attempts (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  generation uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'connected', 'cancelled', 'failed')),
  expires_at timestamptz not null default now() + interval '10 minutes'
);

create index on public.strava_oauth_attempts (user_id);

create table public.strava_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  generation uuid not null,
  kind text not null check (kind in ('webhook', 'activity', 'backfill', 'revoke')),
  dedupe_key text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'complete', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  last_error text,
  unique (generation, dedupe_key)
);

create index on public.strava_jobs (available_at)
  where status in ('pending', 'processing');

create index on public.strava_jobs (user_id, generation);

create table public.strava_activities (
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_id text not null,
  generation uuid not null,
  activity jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, activity_id)
);

-- A short transaction owns each state transition. No provider requests run in SQL.
create function public.strava_begin_oauth(p_user uuid, p_hash text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.strava_connections;
begin
  insert into public.strava_connections(user_id, status)
  values (p_user, 'disconnected')
  on conflict do nothing;

  select * into c
  from public.strava_connections
  where user_id = p_user
  for update;

  if c.status = 'active' then
    return 'already_connected';
  end if;

  if c.status = 'disconnecting' and not c.credentials_uncertain then
    return 'disconnecting';
  end if;

  if c.operation_until > now() then
    return 'in_progress';
  end if;

  update public.strava_connections
  set operation_id = null,
      operation_kind = null,
      operation_until = null
  where user_id = p_user;

  update public.strava_oauth_attempts
  set status = 'cancelled'
  where user_id = p_user
    and status in ('pending', 'processing');

  delete from public.strava_oauth_attempts
  where user_id = p_user
    and expires_at < now() - interval '1 day';

  insert into public.strava_oauth_attempts(state_hash, user_id, generation)
  values (p_hash, p_user, c.generation);

  return 'ready';
end
$$;

create function public.strava_claim_oauth(p_user uuid, p_hash text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.strava_connections;
  a public.strava_oauth_attempts;
begin
  select * into c
  from public.strava_connections
  where user_id = p_user
  for update;

  select * into a
  from public.strava_oauth_attempts
  where state_hash = p_hash and user_id = p_user
  for update;

  if a.state_hash is null then
    return 'invalid_state';
  end if;

  if a.status = 'connected'
    and (c.status <> 'active' or c.generation <> a.generation)
  then
    return 'expired';
  end if;

  if a.status <> 'pending' then
    return a.status;
  end if;

  if a.expires_at <= now()
    or a.generation <> c.generation
    or not (
      c.status in ('disconnected', 'reauth_required')
      or (c.status = 'disconnecting' and c.credentials_uncertain)
    )
  then
    return 'expired';
  end if;

  if c.operation_until > now() then
    return 'in_progress';
  end if;

  update public.strava_oauth_attempts
  set status = 'processing'
  where state_hash = p_hash;

  update public.strava_connections
  set operation_id = gen_random_uuid(),
      operation_kind = p_hash,
      operation_until = now() + interval '2 minutes'
  where user_id = p_user;

  return 'claimed';
end
$$;

create function public.strava_cancel_oauth(p_user uuid, p_hash text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result text;
begin
  perform 1
  from public.strava_connections
  where user_id = p_user
  for update;

  update public.strava_oauth_attempts
  set status = 'cancelled'
  where user_id = p_user
    and state_hash = p_hash
    and status in ('pending', 'processing')
  returning status into result;

  return coalesce(
    result,
    (
      select status
      from public.strava_oauth_attempts
      where user_id = p_user and state_hash = p_hash
    ),
    'invalid_state'
  );
end
$$;

create function public.strava_finish_oauth(
  p_user uuid,
  p_hash text,
  p_tokens jsonb default null,
  p_outcome text default 'failed'
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.strava_connections;
  a public.strava_oauth_attempts;
  result text;
begin
  select * into c
  from public.strava_connections
  where user_id = p_user
  for update;

  select * into a
  from public.strava_oauth_attempts
  where user_id = p_user and state_hash = p_hash
  for update;

  if a.status = 'connected' then
    return case
      when c.status = 'active' and c.generation = a.generation then 'connected'
      else 'expired'
    end;
  end if;

  if a.state_hash is null or c.operation_kind is distinct from p_hash then
    return 'expired';
  end if;

  result := case
    when a.status = 'cancelled'
      or c.generation <> a.generation
      or c.status = 'disconnecting'
    then 'cancelled'
    else p_outcome
  end;

  if p_tokens is not null then
    -- Never revoke a rejected grant: it may belong to another user's live link.
    if exists (
      select 1
      from public.strava_connections
      where athlete_id = p_tokens->>'athlete_id' and user_id <> p_user
    ) or (c.athlete_id is not null and c.athlete_id <> p_tokens->>'athlete_id')
    then
      result := 'athlete_conflict';
    else
      begin
        update public.strava_connections
        set athlete_id = p_tokens->>'athlete_id',
            access_token = p_tokens->>'access_token',
            refresh_token = p_tokens->>'refresh_token',
            expires_at = (p_tokens->>'expires_at')::timestamptz,
            granted_scopes = array(select jsonb_array_elements_text(p_tokens->'scopes')),
            credentials_uncertain = false,
            status = case when result = 'cancelled' then 'disconnecting' else 'active' end,
            generation = case when result = 'cancelled' then generation else gen_random_uuid() end
        where user_id = p_user
        returning * into c;

        delete from public.strava_activities
        where user_id = p_user;

        delete from public.strava_jobs
        where user_id = p_user;

        if result = 'cancelled' then
          insert into public.strava_jobs(user_id, generation, kind, dedupe_key)
          values (p_user, c.generation, 'revoke', 'revoke')
          on conflict do nothing;
        else
          result := 'connected';
        end if;
      exception
        when unique_violation then
          result := 'athlete_conflict';
      end;
    end if;
  end if;

  update public.strava_connections
  set operation_id = null,
      operation_kind = null,
      operation_until = null
  where user_id = p_user;

  update public.strava_oauth_attempts
  set status = case
        when result = 'connected' then 'connected'
        when result = 'cancelled' then 'cancelled'
        else 'failed'
      end,
      generation = case when result = 'connected' then c.generation else generation end
  where state_hash = p_hash;

  return result;
end
$$;

create function public.strava_claim_credentials(p_user uuid, p_kind text)
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

create function public.strava_finish_refresh(
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

  if c.operation_id is distinct from p_operation or c.operation_kind <> 'refresh' then
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

create function public.strava_disconnect(p_user uuid, p_generation uuid default null)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.strava_connections;
begin
  insert into public.strava_connections(user_id, status)
  values (p_user, 'disconnected')
  on conflict do nothing;

  select * into c
  from public.strava_connections
  where user_id = p_user
  for update;

  if p_generation is not null and c.generation <> p_generation then
    return 'obsolete';
  end if;

  update public.strava_oauth_attempts
  set status = 'cancelled'
  where user_id = p_user
    and status in ('pending', 'processing');

  if c.status <> 'disconnecting' then
    update public.strava_connections
    set status = 'disconnecting',
        generation = gen_random_uuid()
    where user_id = p_user
    returning * into c;
  end if;

  delete from public.strava_activities
  where user_id = p_user;

  delete from public.strava_jobs
  where user_id = p_user and generation <> c.generation;

  insert into public.strava_jobs(user_id, generation, kind, dedupe_key)
  values (p_user, c.generation, 'revoke', 'revoke')
  on conflict do nothing;

  return c.status;
end
$$;

create function public.strava_release_credentials(p_user uuid, p_operation uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.strava_connections
  set operation_id = null,
      operation_kind = null,
      operation_until = null
  where user_id = p_user and operation_id = p_operation;
$$;

create function public.strava_finish_disconnect(
  p_user uuid,
  p_generation uuid,
  p_operation uuid default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1
  from public.strava_connections
  where user_id = p_user
  for update;

  update public.strava_connections
  set status = 'disconnected',
      athlete_id = null,
      access_token = null,
      refresh_token = null,
      expires_at = null,
      granted_scopes = '{}',
      operation_id = null,
      operation_kind = null,
      operation_until = null,
      credentials_uncertain = false,
      generation = gen_random_uuid()
  where user_id = p_user
    and generation = p_generation
    and status = 'disconnecting'
    and operation_id is not distinct from p_operation;

  if not found then
    return false;
  end if;

  delete from public.strava_activities
  where user_id = p_user;

  delete from public.strava_jobs
  where user_id = p_user;

  return true;
end
$$;

create function public.strava_provider_revoked(p_user uuid, p_generation uuid)
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

  if c.generation is distinct from p_generation
    or c.operation_id is not null
    or c.credentials_uncertain
  then
    return false;
  end if;

  perform public.strava_disconnect(p_user, p_generation);

  select * into c
  from public.strava_connections
  where user_id = p_user;

  return public.strava_finish_disconnect(p_user, c.generation);
end
$$;

create function public.strava_enqueue(
  p_user uuid,
  p_generation uuid,
  p_kind text,
  p_key text,
  p_payload jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1
  from public.strava_connections
  where user_id = p_user
    and generation = p_generation
    and status = 'active'
  for update;

  if not found then
    return false;
  end if;

  insert into public.strava_jobs(user_id, generation, kind, dedupe_key, payload)
  values (p_user, p_generation, p_kind, p_key, p_payload)
  on conflict do nothing;

  return true;
end
$$;

-- ponytail: one worker per athlete; split into per-activity claims only if throughput requires it.
create function public.strava_claim_job()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.strava_connections;
  j public.strava_jobs;
begin
  select sc.* into c
  from public.strava_connections sc
  where sc.status in ('active', 'disconnecting')
    and (
      sc.status = 'disconnecting'
      or not exists (
        select 1
        from public.strava_connections throttled
        where throttled.rate_limited_until > now()
      )
    )
    and not exists (
      select 1
      from public.strava_jobs busy
      where busy.user_id = sc.user_id
        and busy.status = 'processing'
        and busy.lease_until > now()
    )
    and exists (
      select 1
      from public.strava_jobs due
      where due.user_id = sc.user_id
        and due.generation = sc.generation
        and due.available_at <= now()
        and (
          due.status = 'pending'
          or (due.status = 'processing' and due.lease_until <= now())
        )
    )
  order by sc.user_id
  for update skip locked
  limit 1;

  if c.user_id is null then
    return null;
  end if;

  -- A competing claim can commit after this statement's original snapshot.
  if exists (
    select 1
    from public.strava_jobs
    where user_id = c.user_id
      and status = 'processing'
      and lease_until > now()
  ) then
    return null;
  end if;

  select * into j
  from public.strava_jobs
  where user_id = c.user_id
    and generation = c.generation
    and available_at <= now()
    and (status = 'pending' or (status = 'processing' and lease_until <= now()))
  order by available_at, id
  for update skip locked
  limit 1;

  if j.attempts >= 8 then
    update public.strava_jobs
    set status = 'failed',
        last_error = 'lease_retry_limit',
        lease_id = null,
        lease_until = null
    where id = j.id;

    return null;
  end if;

  update public.strava_jobs
  set status = 'processing',
      attempts = attempts + 1,
      lease_id = gen_random_uuid(),
      lease_until = now() + interval '2 minutes'
  where id = j.id
  returning * into j;

  return to_jsonb(j);
end
$$;

create function public.strava_commit_job(
  p_job uuid,
  p_lease uuid,
  p_activities jsonb default '[]',
  p_error text default null,
  p_delay integer default null,
  p_reauth boolean default false,
  p_continuation jsonb default null,
  p_discoveries jsonb default '[]'
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.strava_connections;
  j public.strava_jobs;
  item jsonb;
begin
  select * into j
  from public.strava_jobs
  where id = p_job;

  if j.id is null then
    return false;
  end if;

  select * into c
  from public.strava_connections
  where user_id = j.user_id
  for update;

  select * into j
  from public.strava_jobs
  where id = p_job
  for update;

  if j.id is null
    or j.lease_id is distinct from p_lease
    or j.lease_until <= now()
    or j.status <> 'processing'
    or j.generation <> c.generation
  then
    return false;
  end if;

  if c.status = 'active' and p_error is null then
    for item in select value from jsonb_array_elements(p_activities) loop
      insert into public.strava_activities(user_id, generation, activity_id, activity)
      values (
        j.user_id,
        j.generation,
        item->>'id',
        nullif(item->'activity', 'null'::jsonb)
      )
      on conflict (user_id, activity_id) do update
      set generation = excluded.generation,
          activity = excluded.activity,
          updated_at = now();
    end loop;

    if p_continuation is not null then
      insert into public.strava_jobs(user_id, generation, kind, dedupe_key, payload)
      values (
        j.user_id,
        j.generation,
        'backfill',
        p_continuation->>'key',
        p_continuation->'payload'
      )
      on conflict do nothing;
    end if;

    for item in select value from jsonb_array_elements(p_discoveries) loop
      insert into public.strava_jobs(user_id, generation, kind, dedupe_key, payload)
      values (
        j.user_id,
        j.generation,
        'activity',
        j.id::text || ':' || (item->>'object_id'),
        item
      )
      on conflict do nothing;
    end loop;
  end if;

  if p_reauth and c.status = 'active' then
    update public.strava_connections
    set status = 'reauth_required'
    where user_id = c.user_id;
  end if;

  update public.strava_jobs
  set status = case
        when p_error is null then 'complete'
        when p_delay is null or attempts >= 8 then 'failed'
        else 'pending'
      end,
      available_at = now() + make_interval(secs => coalesce(p_delay, 0)),
      last_error = p_error,
      lease_id = null,
      lease_until = null
  where id = p_job;

  if p_error = 'rate_limited' then
    update public.strava_connections
    set rate_limited_until = now() + make_interval(secs => p_delay)
    where user_id = c.user_id;
  end if;

  return true;
end
$$;

alter table public.strava_connections enable row level security;
alter table public.strava_oauth_attempts enable row level security;
alter table public.strava_jobs enable row level security;
alter table public.strava_activities enable row level security;

revoke all on
  public.strava_connections,
  public.strava_oauth_attempts,
  public.strava_jobs,
  public.strava_activities
from public, anon, authenticated;

grant select, insert, update, delete on
  public.strava_connections,
  public.strava_oauth_attempts,
  public.strava_jobs,
  public.strava_activities
to service_role;

do $$
declare
  f record;
begin
  for f in
    select oid::regprocedure as signature
    from pg_proc
    where pronamespace = 'public'::regnamespace and proname like 'strava_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end
$$;
