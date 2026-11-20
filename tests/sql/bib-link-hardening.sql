begin;

-- These assertions cover the three things the hardening migration changed: that case-variant BIBs
-- can no longer coexist (so the case-insensitive lookup can never pick an arbitrary registration),
-- that the attempt log is pruned to the throttle window instead of growing forever, and that a
-- held registration can be given back by its holder and nobody else -- carrying no Strava data
-- forward to whoever takes it next.
do $$
declare
  holder uuid := gen_random_uuid();
  rival uuid := gen_random_uuid();
  runner uuid := gen_random_uuid();
  event bigint;
  category bigint;
  signature text;
  browser text;
  stale int;
begin
  insert into auth.users(id) values (holder), (rival);
  insert into public.events(name,event_date) values ('Hardening race','2027-08-17') returning id into event;
  insert into public.categories(event_id,name,distance_km,min_age) values (event,'5K',5,13) returning id into category;
  insert into public.runners(id,category_id,bib_number,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
    values (runner,category,'H1205','Held Name','1990-01-01','M','h1@example.invalid','0','Passport','h1','M');

  -- 1. The folded value is unique, so a case variant of an existing BIB is refused outright. This
  --    is what makes the `select ... into` in the linking routine unambiguous by construction.
  assert (select indisunique from pg_index where indexrelid='public.runners_bib_upper'::regclass),
    'the folded BIB index must be unique';
  begin
    insert into public.runners(category_id,bib_number,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
      values (category,'h1205','Case Variant','1990-01-01','F','h2@example.invalid','0','Passport','h2','M');
    raise exception 'a case-variant duplicate BIB was accepted';
  exception when unique_violation then null;
  end;
  -- An unassigned BIB is still exempt: many registrations may await a number.
  insert into public.runners(category_id,bib_number,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
    values (category,null,'No Number A','1990-01-01','F','h3@example.invalid','0','Passport','h3','M'),
      (category,null,'No Number B','1990-01-01','F','h4@example.invalid','0','Passport','h4','M');

  -- 2. Attempts outside the throttle window are removed by the next call, not kept indefinitely.
  insert into public.bib_link_attempts(user_id, attempted_at, outcome)
    select rival, clock_timestamp() - interval '20 minutes', 'rejected' from generate_series(1,6);
  assert (select count(*) from public.bib_link_attempts where user_id=rival) = 6;
  -- Stale rejections are outside the window, so this must be answered, not throttled.
  assert public.link_runner_by_bib(rival,'Z9999') = 'unavailable';
  select count(*) into stale from public.bib_link_attempts
    where user_id=rival and attempted_at <= clock_timestamp() - interval '15 minutes';
  assert stale = 0, 'attempts outside the throttle window must be pruned';
  assert (select count(*) from public.bib_link_attempts where user_id=rival) = 1,
    'only the fresh rejection should remain';
  -- A malformed entry returns before touching the log, so it neither records nor prunes.
  insert into public.bib_link_attempts(user_id, attempted_at, outcome)
    values (rival, clock_timestamp() - interval '30 minutes', 'rejected');
  assert public.link_runner_by_bib(rival,'not a bib') = 'unavailable';
  assert (select count(*) from public.bib_link_attempts where user_id=rival) = 2,
    'a malformed entry must not prune or record';
  delete from public.bib_link_attempts where user_id=rival;

  -- 3. Releasing. Only the holder may, and only their own ownership row is removed.
  assert public.link_runner_by_bib(holder,'H1205') = 'linked';
  assert public.release_runner_by_bib(rival,'H1205') = 'unavailable',
    'a registration held by someone else must not be releasable';
  assert (select user_id from public.runner_access where runner_id=runner) = holder;
  assert public.release_runner_by_bib(holder,'Z9999') = 'unavailable';
  assert public.release_runner_by_bib(holder,'not a bib') = 'unavailable';
  assert public.release_runner_by_bib(null,'H1205') = 'unavailable';

  -- Case-insensitive on the way out as well as in.
  assert public.release_runner_by_bib(holder,'h1205') = 'released';
  assert not exists(select 1 from public.runner_access where runner_id=runner),
    'releasing must remove the ownership row';
  -- Releasing twice is refused rather than reported as a second success.
  assert public.release_runner_by_bib(holder,'H1205') = 'unavailable';
  -- The registration is free again, and may be taken by a different account.
  assert public.link_runner_by_bib(rival,'H1205') = 'linked';
  assert (select user_id from public.runner_access where runner_id=runner) = rival;

  -- Releasing must not strand private Strava data for the next holder. Every row that hangs off
  -- an ownership row cascades from it, which is the property that makes the delete above safe.
  foreach signature in array array[
    'public.strava_runner_attachments',
    'public.strava_activity_candidates',
    'public.strava_oauth_attempts'
  ] loop
    assert (select bool_and(confdeltype = 'c') from pg_constraint
      where conrelid = signature::regclass and contype = 'f'
        and confrelid = 'public.runner_access'::regclass),
      signature||' must cascade from runner_access so a release leaves nothing behind';
  end loop;

  -- The release routine carries the same server-only posture as the rest of the profile surface.
  foreach browser in array array['anon','authenticated'] loop
    assert not has_function_privilege(browser,'public.release_runner_by_bib(uuid,text)','EXECUTE');
  end loop;
  assert has_function_privilege('service_role','public.release_runner_by_bib(uuid,text)','EXECUTE');
  assert (select not prosecdef and proconfig @> array['search_path=""']
          from pg_proc where oid='public.release_runner_by_bib(uuid,text)'::regprocedure),
    'the release RPC must use invoker rights and a locked empty search path';
end $$;

rollback;
