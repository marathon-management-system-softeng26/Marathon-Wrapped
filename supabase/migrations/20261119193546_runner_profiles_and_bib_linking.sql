-- Runner-owned account details, and self-service registration linking by BIB.
--
-- `runner_profiles` holds the display name an account chooses for itself. It stays separate from
-- `runners.name`, which belongs to the organizer's registration record and feeds timing, results
-- and the recap. A runner naming themselves must never rewrite a timed registration.
--
-- `link_runner_by_bib` lets a signed-in account take an unclaimed registration using its BIB
-- alone. This is a deliberate product decision with a known consequence, recorded here so it is
-- not mistaken for an oversight: BIBs are short and sequential, so an account can enumerate them
-- and `runner_access` is what gates a private recap. Two bounds are enforced below — only an
-- unclaimed registration can be taken, and repeated failures from one account are rate limited —
-- which raises the cost of enumeration without removing it. The one-time `runner_claims` code
-- remains available and remains the safer route.

create table public.runner_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.runner_profiles enable row level security;
revoke all on public.runner_profiles from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.runner_profiles to service_role;

-- Only failed attempts are retained long enough to matter: they are the enumeration signal.
create table public.bib_link_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default clock_timestamp(),
  outcome text not null check (outcome in ('linked', 'rejected'))
);
alter table public.bib_link_attempts enable row level security;
revoke all on public.bib_link_attempts from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.bib_link_attempts to service_role;

create index bib_link_attempts_recent
  on public.bib_link_attempts(user_id, attempted_at desc) where outcome = 'rejected';
create index bib_link_attempts_user on public.bib_link_attempts(user_id);

-- A runner types the BIB on their race pack; the organizer's stored casing is authoritative.
create index runners_bib_upper on public.runners(upper(bib_number));

-- IDs are provided by trusted authenticated server code. Invoker rights keep these routines
-- inside the service role's existing table privileges.
create function public.upsert_runner_profile(p_user uuid, p_name text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  cleaned text;
begin
  if p_user is null then
    raise exception using errcode = '22023', message = 'Invalid profile owner';
  end if;
  cleaned := btrim(coalesce(p_name, ''));
  if cleaned = '' or length(cleaned) > 120 then
    raise exception using errcode = '22023', message = 'Invalid display name';
  end if;
  insert into public.runner_profiles(user_id, display_name) values (p_user, cleaned)
    on conflict (user_id) do update
      set display_name = excluded.display_name, updated_at = clock_timestamp();
  return cleaned;
exception when foreign_key_violation then
  -- A deleted Auth user cannot own a profile.
  raise exception using errcode = '22023', message = 'Invalid profile owner';
end $$;

create function public.link_runner_by_bib(p_user uuid, p_bib text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  rejections int;
  target uuid;
  owner_id uuid;
begin
  if p_user is null or p_bib is null or btrim(p_bib) !~ '^[A-Za-z0-9-]{1,40}$' then
    return 'unavailable';
  end if;

  -- Bound how fast one account can walk the BIB space. Successful links do not count: a runner
  -- with several registrations is not the behaviour being limited.
  select count(*) into rejections from public.bib_link_attempts
    where user_id = p_user and outcome = 'rejected'
      and attempted_at > clock_timestamp() - interval '15 minutes';
  if rejections >= 6 then
    return 'throttled';
  end if;

  -- Competing requests for one registration serialize on this runner row; the unique ownership
  -- index also protects against writers that do not take it.
  select r.id into target from public.runners r
    where upper(r.bib_number) = upper(btrim(p_bib)) for update of r;
  if target is null then
    insert into public.bib_link_attempts(user_id, outcome) values (p_user, 'rejected');
    return 'unavailable';
  end if;

  select ra.user_id into owner_id from public.runner_access ra
    where ra.runner_id = target for share;
  if owner_id is not null then
    if owner_id = p_user then
      insert into public.bib_link_attempts(user_id, outcome) values (p_user, 'linked');
      return 'already_yours';
    end if;
    -- An owned registration is reported exactly like an absent one, so a response never
    -- confirms which BIBs exist.
    insert into public.bib_link_attempts(user_id, outcome) values (p_user, 'rejected');
    return 'unavailable';
  end if;

  insert into public.runner_access(user_id, runner_id) values (p_user, target)
    on conflict (runner_id) do nothing;
  select ra.user_id into owner_id from public.runner_access ra
    where ra.runner_id = target for share;
  if owner_id is distinct from p_user then
    insert into public.bib_link_attempts(user_id, outcome) values (p_user, 'rejected');
    return 'unavailable';
  end if;

  insert into public.bib_link_attempts(user_id, outcome) values (p_user, 'linked');
  return 'linked';
exception when foreign_key_violation then
  -- A missing or deleted Auth user cannot take a registration; this subtransaction also rolls
  -- back any ownership insert whose attempt record then fails.
  return 'unavailable';
end $$;

revoke execute on function public.upsert_runner_profile(uuid,text),
  public.link_runner_by_bib(uuid,text) from public, anon, authenticated;
grant execute on function public.upsert_runner_profile(uuid,text),
  public.link_runner_by_bib(uuid,text) to service_role;
