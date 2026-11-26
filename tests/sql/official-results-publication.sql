begin;

create function pg_temp.run_fixture(
  edition bigint, competition bigint, digest text,
  pages integer default 1, review_missing boolean default false, review_changes boolean default false
) returns uuid language sql as $$
  insert into public.scorenow_import_runs(
    event_id,competition_id,race_id,manifest_digest,parser_version,manifest,
    missing_details_reviewed,identity_changes_reviewed
  ) values (
    edition,competition,3,repeat(digest,64),'fixture-v1',
    jsonb_build_object('distances',jsonb_build_object(
      '5K',jsonb_build_object('advertisedTotal',1,'pageCount',pages),
      '10K',jsonb_build_object('advertisedTotal',1,'pageCount',1)
    )),
    review_missing,review_changes
  ) returning id
$$;

create function pg_temp.stage_fixture(
  run_id uuid, short_bib text, long_bib text, finish_time integer,
  short_detail text default 'resolved', short_uid text default 'short-uid', long_uid text default 'long-uid',
  detail_bib text default null
) returns void language plpgsql as $$
begin
  insert into public.scorenow_import_pages(run_id,distance,page_number,row_count)
    values (run_id,'5K',1,1),(run_id,'10K',1,1);
  insert into public.scorenow_import_rows(
    run_id,distance,page_number,row_number,bib,name,status,source_uid,source_url,
    finish_time_ms,detail_outcome,detail_identity,checkpoints,raw_source
  ) values
  (
    run_id,'5K',1,1,short_bib,'Short fixture','finished',short_uid,
    case when short_detail='resolved' then 'https://results.scorenow.co.id/details.aspx' end,
    finish_time,short_detail,case when short_detail='resolved' then
      jsonb_build_object('competitionId',2,'raceId',3,'bib',coalesce(detail_bib,short_bib),
        'distance','5K','sourceUid',short_uid) end,
    '[{"sequence":1,"label":"KM 3.3","distanceMeters":3300,"displayedTimeMs":718800,
       "reportedSplitMs":717800,"referenceLabel":"Start"}]'::jsonb,'fixture-restricted'
  ), (
    run_id,'10K',1,1,long_bib,'Long fixture','dnf',long_uid,'https://results.scorenow.co.id/details.aspx',
    null,'resolved',jsonb_build_object('competitionId',2,'raceId',3,'bib',long_bib,'distance','10K','sourceUid',long_uid),'[]',null
  );
end $$;

create function pg_temp.assert_publish_rejected(run_id uuid)
returns void language plpgsql as $$
begin
  perform public.publish_scorenow_import(run_id);
  raise exception 'An invalid import was published';
exception when invalid_parameter_value then null;
end $$;

do $$
declare
  edition bigint;
  initial_run uuid;
  revised_run uuid;
  invalid_run uuid;
  other_run uuid;
  runner uuid;
  owner_id uuid := gen_random_uuid();
begin
  insert into public.events(name,event_date,scorenow_competition_id,scorenow_race_id)
    values ('Publication fixture','2026-02-15',2,3) returning id into edition;
  insert into public.categories(event_id,name,distance_km,min_age)
    values (edition,'5K',5,13),(edition,'10K',10,17);

  initial_run := pg_temp.run_fixture(edition,2,'a');
  perform pg_temp.stage_fixture(initial_run,'00123','00456',2005213);
  -- A staging retry updates the same source ordinal and validates the run's digest.
  assert public.stage_scorenow_import_rows(initial_run,repeat('a',64),(
    select jsonb_agg(to_jsonb(s)-'run_id') from public.scorenow_import_rows s
    where s.run_id=initial_run and s.distance='5K'
  ))=1;
  begin
    perform public.stage_scorenow_import_rows(initial_run,repeat('9',64),'[{}]');
    raise exception 'A mismatched artifact digest was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.stage_scorenow_import_rows(initial_run,repeat('a',64),(
      select jsonb_agg('{}'::jsonb) from generate_series(1,101)
    ));
    raise exception 'An oversized staging batch was accepted';
  exception when invalid_parameter_value then null;
  end;

  assert public.publish_scorenow_import(initial_run)
    = jsonb_build_object('eventId',edition,'counts','{"5K":1,"10K":1}'::jsonb);
  select runner_id into strict runner from public.official_race_results where event_id=edition and bib='00123';
  assert (select finish_time_ms=2005213 from public.official_race_results where runner_id=runner);
  assert (select displayed_time_ms=718800 and reported_split_ms=717800 and reference_label='Start'
    from public.official_race_checkpoints where runner_id=runner and sequence=1);
  assert (select status='dnf' and finish_time_ms is null from public.official_race_results where event_id=edition and bib='00456');

  insert into auth.users(id) values (owner_id);
  insert into public.runner_access(user_id,runner_id) values (owner_id,runner);
  insert into public.strava_connections(user_id,generation,status) values (owner_id,gen_random_uuid(),'active');
  assert public.strava_attach_runner(owner_id,runner)='attached';

  invalid_run := pg_temp.run_fixture(edition,2,'b',2);
  perform pg_temp.stage_fixture(invalid_run,'00123','00456',1);
  perform pg_temp.assert_publish_rejected(invalid_run);

  invalid_run := pg_temp.run_fixture(edition,2,'c');
  perform pg_temp.stage_fixture(invalid_run,'00123','00456',1,'failed');
  perform pg_temp.assert_publish_rejected(invalid_run);

  invalid_run := pg_temp.run_fixture(edition,2,'d');
  perform pg_temp.stage_fixture(invalid_run,'00123','00456',1,'no_link',null);
  perform pg_temp.assert_publish_rejected(invalid_run);

  invalid_run := pg_temp.run_fixture(edition,7,'e');
  perform pg_temp.stage_fixture(invalid_run,'00123','00456',1);
  perform pg_temp.assert_publish_rejected(invalid_run);

  invalid_run := pg_temp.run_fixture(edition,2,'f');
  perform pg_temp.stage_fixture(invalid_run,'00123','00123',1);
  perform pg_temp.assert_publish_rejected(invalid_run);

  invalid_run := pg_temp.run_fixture(edition,2,'1');
  perform pg_temp.stage_fixture(invalid_run,'00123','00456',1,'resolved','short-uid','short-uid');
  perform pg_temp.assert_publish_rejected(invalid_run);

  invalid_run := pg_temp.run_fixture(edition,2,'2');
  perform pg_temp.stage_fixture(invalid_run,'00123','00456',1,'resolved','short-uid','long-uid','00456');
  perform pg_temp.assert_publish_rejected(invalid_run);

  invalid_run := pg_temp.run_fixture(edition,2,'3');
  other_run := pg_temp.run_fixture(edition,2,'4');
  perform pg_temp.stage_fixture(invalid_run,'00123','00456',1);
  perform pg_temp.stage_fixture(other_run,'00123','00456',1);
  delete from public.scorenow_import_rows where run_id=invalid_run and distance='10K';
  delete from public.scorenow_import_rows where run_id=other_run and distance='5K';
  perform pg_temp.assert_publish_rejected(invalid_run);
  perform pg_temp.assert_publish_rejected(other_run);

  invalid_run := pg_temp.run_fixture(edition,2,'5',1,false,true);
  perform pg_temp.stage_fixture(invalid_run,'00456','00123',1);
  perform pg_temp.assert_publish_rejected(invalid_run);

  assert (select finish_time_ms=2005213 and published_run_id=initial_run
    from public.official_race_results where runner_id=runner), 'A failed run must preserve the previous result';

  revised_run := pg_temp.run_fixture(edition,2,'6');
  perform pg_temp.stage_fixture(revised_run,'00123','00456',2005200);
  perform public.publish_scorenow_import(revised_run);
  assert (select finish_time_ms=2005200 and published_run_id=revised_run
    from public.official_race_results where runner_id=runner), 'An updated run must keep its original runner UUID';
  perform public.publish_scorenow_import(initial_run);
  assert (select finish_time_ms=2005200 from public.official_race_results where runner_id=runner),
    'Retrying an earlier published run must leave the new data readable';
  assert exists(select 1 from public.runner_access where user_id=owner_id and runner_id=runner);
  assert exists(select 1 from public.strava_runner_attachments where user_id=owner_id and runner_id=runner);

  revised_run := pg_temp.run_fixture(edition,2,'7',1,true,true);
  perform pg_temp.stage_fixture(revised_run,'00123','00456',2005199,'no_link',null);
  delete from public.scorenow_import_rows where run_id=revised_run and distance='10K';
  update public.scorenow_import_pages set row_count=0 where run_id=revised_run and distance='10K';
  update public.scorenow_import_runs
    set manifest=jsonb_set(manifest,'{distances,10K,advertisedTotal}','0')
    where id=revised_run;
  assert public.publish_scorenow_import(revised_run)->'counts'='{"5K":1,"10K":0}'::jsonb;
  assert (select source_uid='short-uid' and finish_time_ms=2005199
    from public.official_race_results where runner_id=runner),
    'An approved missing link must keep the existing UID and runner mapping';
  assert exists(select 1 from public.official_race_results where event_id=edition and bib='00456'),
    'An approved omission must leave the previous result readable';
end $$;

do $$
declare
  role_name text;
  table_name text;
begin
  assert exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='publish_scorenow_import'
      and 'statement_timeout=10min'=any(coalesce(p.proconfig,array[]::text[]))
  ), 'Full-catalog publication must override the short PostgREST statement timeout';

  foreach role_name in array array['anon','authenticated'] loop
    foreach table_name in array array[
      'scorenow_import_runs','scorenow_import_pages','scorenow_import_rows',
      'official_race_results','official_race_checkpoints'
    ] loop
      assert not has_table_privilege(role_name,'public.'||table_name,'select');
      assert not has_table_privilege(role_name,'public.'||table_name,'insert');
    end loop;
    assert not has_function_privilege(role_name,'public.publish_scorenow_import(uuid)','execute');
    assert not has_function_privilege(role_name,'public.stage_scorenow_import_rows(uuid,text,jsonb)','execute');
  end loop;
end $$;

rollback;

