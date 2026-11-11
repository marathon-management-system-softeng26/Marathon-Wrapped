-- Never resolve ownership conflicts automatically during an upgrade.
do $$
begin
  if exists (select 1 from public.runner_access group by runner_id having count(*) > 1) then
    raise exception using errcode = '23505',
      message = 'Cannot enable runner claims: duplicate direct owners exist in runner_access',
      hint = 'Review runner_access grouped by runner_id and resolve ownership explicitly before retrying this migration.';
  end if;
end $$;

create unique index runner_access_one_owner on public.runner_access(runner_id);
drop index public.runner_access_runner;

create table public.runner_claims (
  id uuid primary key default gen_random_uuid(),
  runner_id uuid not null references public.runners(id) on delete cascade,
  event_id bigint not null references public.events(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  claimed_by uuid references auth.users(id),
  claimed_at timestamptz,
  revoked_at timestamptz,
  constraint runner_claim_expiry check (
    isfinite(created_at) and isfinite(expires_at)
    and expires_at > created_at and expires_at <= created_at + interval '7 days'
  ),
  constraint runner_claim_claimant check ((claimed_by is null) = (claimed_at is null))
);
alter table public.runner_claims enable row level security;
revoke all on public.runner_claims from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.runner_claims to service_role;

create index runner_claims_runner on public.runner_claims(runner_id);
create index runner_claims_event on public.runner_claims(event_id);
create index runner_claims_creator on public.runner_claims(created_by);
create index runner_claims_claimant on public.runner_claims(claimed_by);
create index runner_claims_pending_expiry on public.runner_claims(expires_at)
  where claimed_at is null and revoked_at is null;
create index runner_claims_revoked on public.runner_claims(revoked_at)
  where revoked_at is not null;

-- IDs are provided by trusted authenticated server code. Invoker rights keep
-- these routines inside the service role's existing table privileges.
create function public.create_runner_claim(
  p_organizer uuid, p_event bigint, p_runner uuid, p_hash text, p_expires_at timestamptz
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  claim_id uuid;
  created timestamptz;
begin
  perform 1 from public.organizer_access a
    where a.user_id = p_organizer and a.event_id = p_event for share;
  if not found then
    raise exception using errcode = '42501', message = 'Claim creation is not authorized';
  end if;
  -- Lock the membership used for authorization against concurrent reassignment.
  perform 1 from public.runners r join public.categories c on c.id = r.category_id
    where r.id = p_runner and c.event_id = p_event for share of r, c;
  if not found then
    raise exception using errcode = '42501', message = 'Claim creation is not authorized';
  end if;
  created := clock_timestamp();
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null or not isfinite(p_expires_at)
    or p_expires_at <= created or p_expires_at > created + interval '7 days' then
    raise exception using errcode = '22023', message = 'Invalid claim hash or expiry';
  end if;
  insert into public.runner_claims(runner_id,event_id,token_hash,created_by,created_at,expires_at)
    values (p_runner,p_event,p_hash,p_organizer,created,p_expires_at) returning id into claim_id;
  return claim_id;
end $$;

create function public.consume_runner_claim(p_user uuid, p_hash text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  claim public.runner_claims%rowtype;
  owner_id uuid;
begin
  if p_user is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    return 'invalid_claim';
  end if;
  select * into claim from public.runner_claims where token_hash = p_hash for update;
  if not found then return 'invalid_claim'; end if;

  -- Different codes for one runner serialize here; the unique ownership index
  -- also protects against direct inserts that do not take this runner lock.
  perform 1 from public.runners r join public.categories c on c.id = r.category_id
    where r.id = claim.runner_id and c.event_id = claim.event_id
    for update of r for share of c;
  if not found or claim.revoked_at is not null or claim.expires_at <= clock_timestamp() then
    return 'invalid_claim';
  end if;
  if claim.claimed_by is not null then
    if claim.claimed_by = p_user and exists (
      select 1 from public.runner_access where runner_id = claim.runner_id and user_id = p_user
    ) then return 'already_claimed_by_you'; end if;
    return 'invalid_claim';
  end if;

  insert into public.runner_access(user_id,runner_id) values (p_user,claim.runner_id)
    on conflict (runner_id) do nothing;
  select user_id into owner_id from public.runner_access where runner_id = claim.runner_id for share;
  if owner_id is distinct from p_user then return 'invalid_claim'; end if;
  update public.runner_claims set claimed_by = p_user, claimed_at = clock_timestamp() where id = claim.id;
  return 'claimed';
exception when foreign_key_violation then
  -- A missing/deleted Auth user cannot consume a claim; this subtransaction also
  -- rolls back any ownership insert if its subsequent claimant update fails.
  return 'invalid_claim';
end $$;

create function public.revoke_runner_claim(p_organizer uuid, p_event bigint, p_claim uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.organizer_access a
    where a.user_id = p_organizer and a.event_id = p_event for share;
  if not found then return false; end if;
  update public.runner_claims set revoked_at = clock_timestamp()
    where id = p_claim and event_id = p_event and revoked_at is null and claimed_at is null;
  return found;
end $$;

revoke execute on function public.create_runner_claim(uuid,bigint,uuid,text,timestamptz),
  public.consume_runner_claim(uuid,text), public.revoke_runner_claim(uuid,bigint,uuid)
  from public, anon, authenticated;
grant execute on function public.create_runner_claim(uuid,bigint,uuid,text,timestamptz),
  public.consume_runner_claim(uuid,text), public.revoke_runner_claim(uuid,bigint,uuid)
  to service_role;
