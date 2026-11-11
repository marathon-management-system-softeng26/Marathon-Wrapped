begin;

-- These assertions catch missing event authorization, leaked token storage,
-- replay/expiry bypasses, duplicate ownership, and accidental browser grants.
do $$
declare
  organizer uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  claimant uuid := gen_random_uuid();
  rival uuid := gen_random_uuid();
  runner uuid := gen_random_uuid();
  second_runner uuid := gen_random_uuid();
  other_runner uuid := gen_random_uuid();
  event bigint;
  other_event bigint;
  category bigint;
  other_category bigint;
  claim uuid;
  revoked_claim uuid;
  browser text;
  signature text;
begin
  assert to_regclass('public.runner_claims') is not null, 'runner_claims table must exist';
  insert into auth.users values (organizer), (outsider), (claimant), (rival);
  insert into public.events(name,event_date) values ('Claim event','2027-08-17') returning id into event;
  insert into public.events(name,event_date) values ('Other claim event','2027-08-17') returning id into other_event;
  insert into public.categories(event_id,name,distance_km,min_age) values (event,'5K',5,17) returning id into category;
  insert into public.categories(event_id,name,distance_km,min_age) values (other_event,'5K',5,17) returning id into other_category;
  insert into public.runners(id,category_id,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
    values (runner,category,'Claim runner','1990-01-01','M','claim1@example.invalid','0','Passport','claim1','M'),
      (second_runner,category,'Second runner','1990-01-01','M','claim2@example.invalid','0','Passport','claim2','M'),
      (other_runner,other_category,'Other runner','1990-01-01','M','claim3@example.invalid','0','Passport','claim3','M');
  insert into public.organizer_access values (organizer,event);

  begin
    perform public.create_runner_claim(outsider,event,runner,repeat('a',64),now()+interval '7 days');
    raise exception 'unmapped organizer created a claim';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_runner_claim(organizer,other_event,other_runner,repeat('a',64),now()+interval '7 days');
    raise exception 'organizer created a claim for another event';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_runner_claim(organizer,event,other_runner,repeat('a',64),now()+interval '7 days');
    raise exception 'organizer created a mismatched runner/event claim';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_runner_claim(organizer,event,runner,'raw-claim-token',now()+interval '7 days');
    raise exception 'raw claim token accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_runner_claim(organizer,event,runner,repeat('a',64),now()+interval '8 days');
    raise exception 'expiry beyond seven days accepted';
  exception when invalid_parameter_value then null;
  end;
  claim := public.create_runner_claim(organizer,event,runner,repeat('a',64),now()+interval '7 days');
  assert exists(select 1 from public.runner_claims where id=claim and token_hash=repeat('a',64)
    and created_by=organizer and runner_id=runner and event_id=event and created_at is not null);
  assert not exists(select 1 from public.runner_claims c where to_jsonb(c)::text like '%raw-claim-token%');
  assert public.consume_runner_claim(claimant,repeat('a',64)) = 'claimed';
  assert (select count(*) from public.runner_access a where a.runner_id=runner) = 1;
  assert exists(select 1 from public.runner_claims where id=claim and claimed_by=claimant and claimed_at is not null);
  assert public.consume_runner_claim(claimant,repeat('a',64)) = 'already_claimed_by_you';
  assert public.consume_runner_claim(rival,repeat('a',64)) = 'invalid_claim';
  assert (select count(*) from public.runner_access a where a.runner_id=runner) = 1;
  assert public.consume_runner_claim(claimant,repeat('f',64)) = 'invalid_claim';
  assert public.consume_runner_claim(null,repeat('a',64)) = 'invalid_claim';
  assert public.consume_runner_claim(claimant,null) = 'invalid_claim';

  -- A different valid code cannot transfer an existing direct owner.
  perform public.create_runner_claim(organizer,event,runner,repeat('b',64),now()+interval '7 days');
  assert public.consume_runner_claim(gen_random_uuid(),repeat('b',64)) = 'invalid_claim';
  assert public.consume_runner_claim(rival,repeat('b',64)) = 'invalid_claim';
  assert exists(select 1 from public.runner_claims where token_hash=repeat('b',64) and claimed_at is null and claimed_by is null);
  begin
    insert into public.runner_access values (rival,runner);
    raise exception 'runner acquired two direct owners';
  exception when unique_violation then null;
  end;

  revoked_claim := public.create_runner_claim(organizer,event,second_runner,repeat('c',64),now()+interval '7 days');
  assert public.consume_runner_claim(gen_random_uuid(),repeat('c',64)) = 'invalid_claim';
  assert not exists(select 1 from public.runner_access a where a.runner_id=second_runner);
  assert exists(select 1 from public.runner_claims where id=revoked_claim and claimed_by is null and claimed_at is null);
  assert public.revoke_runner_claim(outsider,event,revoked_claim) = false;
  assert public.revoke_runner_claim(organizer,other_event,revoked_claim) = false;
  assert public.revoke_runner_claim(organizer,event,revoked_claim) = true;
  assert public.consume_runner_claim(claimant,repeat('c',64)) = 'invalid_claim';
  claim := public.create_runner_claim(organizer,event,second_runner,repeat('d',64),now()+interval '7 days');
  update public.runner_claims set created_at=now()-interval '8 days',expires_at=now()-interval '1 day' where id=claim;
  assert public.consume_runner_claim(claimant,repeat('d',64)) = 'invalid_claim';
  claim := public.create_runner_claim(organizer,event,second_runner,repeat('e',64),now()+interval '7 days');
  update public.runner_claims set event_id=other_event where id=claim;
  assert public.consume_runner_claim(claimant,repeat('e',64)) = 'invalid_claim';
  perform public.create_runner_claim(organizer,event,second_runner,repeat('1',64),now()+interval '7 days');
  assert public.consume_runner_claim(claimant,repeat('1',64)) = 'claimed';
  assert (select count(*) from public.runner_access where user_id=claimant) = 2;

  -- A historical claim must never restore access that was removed later.
  delete from public.runner_access a where a.runner_id=runner;
  assert public.consume_runner_claim(claimant,repeat('a',64)) = 'invalid_claim';
  assert not exists(select 1 from public.runner_access a where a.runner_id=runner);

  assert (select relrowsecurity from pg_class where oid='public.runner_claims'::regclass);
  assert not exists(select 1 from pg_policy where polrelid='public.runner_claims'::regclass),
    'server-only claims must not gain browser policies';
  assert has_table_privilege('service_role','public.runner_claims','SELECT')
    and has_table_privilege('service_role','public.runner_claims','INSERT')
    and has_table_privilege('service_role','public.runner_claims','UPDATE')
    and has_table_privilege('service_role','public.runner_claims','DELETE');
  assert not has_table_privilege('service_role','public.runner_claims','TRUNCATE,REFERENCES,TRIGGER');
  assert not exists (
    select 1 from pg_constraint fk where fk.conrelid='public.runner_claims'::regclass
      and fk.contype='f' and not exists (
        select 1 from pg_index i where i.indrelid=fk.conrelid and i.indisvalid
          and i.indpred is null and i.indkey[0]=fk.conkey[1]
      )
  ), 'every claim foreign key needs a leading, nonpartial index';
  assert exists(select 1 from pg_index where indexrelid='public.runner_claims_pending_expiry'::regclass and indpred is not null and indisvalid);
  assert exists(select 1 from pg_index where indexrelid='public.runner_claims_revoked'::regclass and indpred is not null and indisvalid);
  foreach browser in array array['anon','authenticated'] loop
    assert not has_table_privilege(browser,'public.runner_claims','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
    foreach signature in array array[
      'public.create_runner_claim(uuid,bigint,uuid,text,timestamp with time zone)',
      'public.consume_runner_claim(uuid,text)',
      'public.revoke_runner_claim(uuid,bigint,uuid)'
    ] loop
      assert not has_function_privilege(browser,signature,'EXECUTE');
      assert has_function_privilege('service_role',signature,'EXECUTE');
      assert (select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=signature::regprocedure),
        'claim RPCs must use invoker rights and a locked empty search path';
    end loop;
  end loop;
end $$;

rollback;
