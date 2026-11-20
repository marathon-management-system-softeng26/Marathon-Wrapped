-- Hardening for the BIB self-service linking added in 20261119193546, from its design review.
--
-- Three findings, in the order they are addressed below:
--   1. `runners_bib_upper` was not unique while `runners_bib_number_key` is case-sensitive, so
--      'A1205' and 'a1205' could both exist as separate registrations. `link_runner_by_bib`
--      matches on the folded value, which then matched two rows, and a non-STRICT
--      `select ... into` silently took an arbitrary one and locked only that row. Folding the
--      uniqueness constraint removes the ambiguity at its source rather than at the call site.
--   2. `bib_link_attempts` grew without bound, keeping a per-account record of which BIBs an
--      account guessed and when, indefinitely. Only the throttle window is load-bearing.
--   3. A registration taken by BIB could never be given back. Nothing anywhere deleted a
--      `runner_access` row, so a runner who linked the wrong BIB — or whose BIB was taken by
--      someone else first — had no route out that did not involve an operator.

-- 1. Case-folded uniqueness. Unassigned BIBs stay exempt: a unique index permits many nulls.
drop index public.runners_bib_upper;
create unique index runners_bib_upper on public.runners(upper(bib_number));

-- 2. Pruning is added to the linking routine itself, so the log stays bounded by the activity
--    that writes it and needs no scheduler.
create or replace function public.link_runner_by_bib(p_user uuid, p_bib text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  rejections int;
  target uuid;
  owner_id uuid;
begin
  if p_user is null or p_bib is null or btrim(p_bib) !~ '^[A-Za-z0-9-]{1,40}$' then
    return 'unavailable';
  end if;

  -- Retention: keep only what the throttle below can still read. A malformed entry returns above
  -- without reaching this, so it neither records nor prunes anything.
  delete from public.bib_link_attempts
    where user_id = p_user and attempted_at <= clock_timestamp() - interval '15 minutes';

  -- Bound how fast one account can walk the BIB space. Successful links do not count: a runner
  -- with several registrations is not the behaviour being limited.
  select count(*) into rejections from public.bib_link_attempts
    where user_id = p_user and outcome = 'rejected'
      and attempted_at > clock_timestamp() - interval '15 minutes';
  if rejections >= 6 then
    return 'throttled';
  end if;

  -- At most one row can match now that the folded value is unique, so this both selects and
  -- locks exactly the contested registration.
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

-- 3. Giving a registration back. Only the holder can, and only their own ownership row is
--    touched. Every dependent Strava row -- attachment, candidate, activity, snapshot and live
--    metric -- cascades from this delete, so a released registration carries no private data
--    forward to whoever takes it next.
create function public.release_runner_by_bib(p_user uuid, p_bib text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  target uuid;
begin
  if p_user is null or p_bib is null or btrim(p_bib) !~ '^[A-Za-z0-9-]{1,40}$' then
    return 'unavailable';
  end if;

  select r.id into target from public.runners r
    where upper(r.bib_number) = upper(btrim(p_bib)) for update of r;
  if target is null then
    return 'unavailable';
  end if;

  delete from public.runner_access where runner_id = target and user_id = p_user;
  if not found then
    -- A registration held by someone else is reported exactly like an absent one. Releasing is
    -- therefore never an oracle for which BIBs exist or who holds them.
    return 'unavailable';
  end if;
  return 'released';
end $$;

revoke execute on function public.release_runner_by_bib(uuid,text) from public, anon, authenticated;
grant execute on function public.release_runner_by_bib(uuid,text) to service_role;
revoke execute on function public.link_runner_by_bib(uuid,text) from public, anon, authenticated;
grant execute on function public.link_runner_by_bib(uuid,text) to service_role;
