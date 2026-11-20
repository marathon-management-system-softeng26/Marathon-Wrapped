begin;

-- These assertions catch a profile name bleeding into the organizer's registration record, a BIB
-- link that takes an already-owned registration, a response that distinguishes an absent BIB from
-- an owned one, a throttle that punishes legitimate multi-registration runners, and accidental
-- browser grants on either new table.
do $$
declare
  claimant uuid := gen_random_uuid();
  rival uuid := gen_random_uuid();
  walker uuid := gen_random_uuid();
  runner uuid := gen_random_uuid();
  second_runner uuid := gen_random_uuid();
  unnumbered uuid := gen_random_uuid();
  event bigint;
  category bigint;
  first_seen timestamptz;
  browser text;
  signature text;
  attempt int;
begin
  assert to_regclass('public.runner_profiles') is not null, 'runner_profiles table must exist';
  assert to_regclass('public.bib_link_attempts') is not null, 'bib_link_attempts table must exist';

  insert into auth.users(id) values (claimant), (rival), (walker);
  insert into public.events(name,event_date) values ('Profile race','2027-08-17') returning id into event;
  insert into public.categories(event_id,name,distance_km,min_age) values (event,'5K',5,13) returning id into category;
  insert into public.runners(id,category_id,bib_number,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
    values (runner,category,'A1205','Registered Name','1990-01-01','M','p1@example.invalid','0','Passport','p1','M'),
      (second_runner,category,'A1206','Second Name','1990-01-01','F','p2@example.invalid','0','Passport','p2','M'),
      (unnumbered,category,null,'Unnumbered Name','1990-01-01','F','p3@example.invalid','0','Passport','p3','M');

  -- A runner naming themselves must not touch the organizer's registration record.
  assert public.upsert_runner_profile(claimant,'  Dewi Kartika  ') = 'Dewi Kartika';
  select updated_at into first_seen from public.runner_profiles where user_id=claimant;
  assert public.upsert_runner_profile(claimant,'Dewi K.') = 'Dewi K.';
  assert (select display_name from public.runner_profiles where user_id=claimant) = 'Dewi K.';
  assert (select updated_at from public.runner_profiles where user_id=claimant) >= first_seen;
  assert (select count(*) from public.runner_profiles where user_id=claimant) = 1;
  assert (select name from public.runners where id=runner) = 'Registered Name',
    'a profile name must never rewrite a timed registration';

  begin
    perform public.upsert_runner_profile(claimant,'   ');
    raise exception 'blank display name was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.upsert_runner_profile(claimant,repeat('n',121));
    raise exception 'overlong display name was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.upsert_runner_profile(gen_random_uuid(),'Ghost');
    raise exception 'a profile was created for an absent account';
  exception when invalid_parameter_value then null;
  end;

  -- A malformed BIB cannot match anything, so it is not an enumeration attempt.
  assert public.link_runner_by_bib(claimant,'not a bib') = 'unavailable';
  assert public.link_runner_by_bib(claimant,null) = 'unavailable';
  assert not exists(select 1 from public.bib_link_attempts where user_id=claimant);

  -- An unclaimed registration links, and the BIB is matched case-insensitively.
  assert public.link_runner_by_bib(claimant,'a1205') = 'linked';
  assert exists(select 1 from public.runner_access where user_id=claimant and runner_id=runner);
  assert (select count(*) from public.runner_access where runner_id=runner) = 1;

  -- Repeating a link the account already holds changes nothing and is not a failure.
  assert public.link_runner_by_bib(claimant,'A1205') = 'already_yours';
  assert (select count(*) from public.runner_access where runner_id=runner) = 1;

  -- One account may hold several registrations, and successes never count toward the throttle.
  assert public.link_runner_by_bib(claimant,'A1206') = 'linked';
  assert (select count(*) from public.runner_access where user_id=claimant) = 2;
  assert not exists(select 1 from public.bib_link_attempts where user_id=claimant and outcome='rejected');

  -- An owned registration is reported exactly like an absent one.
  assert public.link_runner_by_bib(rival,'A1205') = 'unavailable';
  assert public.link_runner_by_bib(rival,'Z9999') = 'unavailable';
  assert (select user_id from public.runner_access where runner_id=runner) = claimant;

  -- A registration with no BIB assigned cannot be reached this way at all.
  assert public.link_runner_by_bib(rival,'none') = 'unavailable';
  assert not exists(select 1 from public.runner_access where runner_id=unnumbered);

  -- Walking the BIB space costs the account its attempts; the seventh failure is refused.
  for attempt in 1..6 loop
    assert public.link_runner_by_bib(walker,'B000'||attempt::text) = 'unavailable',
      'rejection '||attempt::text||' must still be answered';
  end loop;
  assert public.link_runner_by_bib(walker,'B0007') = 'throttled';
  assert (select count(*) from public.bib_link_attempts where user_id=walker and outcome='rejected') = 6,
    'a throttled attempt must not extend the window it was refused for';

  assert (select relrowsecurity from pg_class where oid='public.runner_profiles'::regclass);
  assert (select relrowsecurity from pg_class where oid='public.bib_link_attempts'::regclass);
  assert not exists(select 1 from pg_policy where polrelid in
    ('public.runner_profiles'::regclass,'public.bib_link_attempts'::regclass)),
    'server-only profile tables must not gain browser policies';
  assert exists(select 1 from pg_index where indexrelid='public.runners_bib_upper'::regclass and indisvalid);
  assert exists(select 1 from pg_index where indexrelid='public.bib_link_attempts_recent'::regclass
    and indpred is not null and indisvalid);
  assert not exists (
    select 1 from pg_constraint fk
      where fk.conrelid in ('public.runner_profiles'::regclass,'public.bib_link_attempts'::regclass)
        and fk.contype='f' and not exists (
          select 1 from pg_index i where i.indrelid=fk.conrelid and i.indisvalid
            and i.indpred is null and i.indkey[0]=fk.conkey[1]
        )
  ), 'every profile foreign key needs a leading, nonpartial index';

  foreach browser in array array['anon','authenticated'] loop
    assert not has_table_privilege(browser,'public.runner_profiles','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
    assert not has_table_privilege(browser,'public.bib_link_attempts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
    foreach signature in array array[
      'public.upsert_runner_profile(uuid,text)',
      'public.link_runner_by_bib(uuid,text)'
    ] loop
      assert not has_function_privilege(browser,signature,'EXECUTE');
      assert has_function_privilege('service_role',signature,'EXECUTE');
      assert (select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=signature::regprocedure),
        'profile RPCs must use invoker rights and a locked empty search path';
    end loop;
  end loop;
  foreach signature in array array['public.runner_profiles','public.bib_link_attempts'] loop
    assert has_table_privilege('service_role',signature,'SELECT')
      and has_table_privilege('service_role',signature,'INSERT')
      and has_table_privilege('service_role',signature,'UPDATE')
      and has_table_privilege('service_role',signature,'DELETE');
    assert not has_table_privilege('service_role',signature,'TRUNCATE,REFERENCES,TRIGGER');
  end loop;
end $$;

rollback;
