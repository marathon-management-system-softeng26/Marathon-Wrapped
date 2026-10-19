begin;
do $$
declare event_key bigint; runner_key uuid; source_key uuid; denied boolean;
  draft jsonb := '{"name":"Temporary management fixture","bib_number":"QA-ORGANIZER","date_of_birth":"1995-04-12","gender":"F","parental_consent":false,"category":"5K","result":{"finisher":true,"start_status":"on-time","start_time":"2027-08-17T06:00:00+07:00","finish_time":"2027-08-17T06:25:00+07:00"},"splits":[{"km_marker":1,"split_seconds":300},{"km_marker":2,"split_seconds":300},{"km_marker":3,"split_seconds":300},{"km_marker":4,"split_seconds":300},{"km_marker":5,"split_seconds":300}]}'::jsonb;
begin
  select id into event_key from public.events where name='Soekarno Run 2027';
  runner_key:=public.save_hero_runner(event_key,null,draft);
  assert (select count(*) from public.chip_splits where runner_id=runner_key)=5, 'Atomic create writes complete splits';
  select id into source_key from public.runners where bib_number='HERO-5K-001';
  denied:=false;
  begin
    perform public.save_hero_runner(event_key,source_key,
      jsonb_set(jsonb_set(draft,'{bib_number}','"HERO-5K-001"'),'{splits,4,km_marker}','1'));
  exception when unique_violation then denied:=true; end;
  assert denied, 'Late split rejection must fail save';
  assert (select name from public.runners where id=source_key)='Aina Putri', 'Rejected update must restore runner';
  assert (select count(*) from public.chip_splits where runner_id=source_key)=5, 'Rejected update must restore original splits';
  assert (select elapsed_seconds from public.chip_results where runner_id=source_key)=1523, 'Rejected update must restore original result';

  denied:=false;
  begin perform public.save_hero_runner(event_key,null,draft);
  exception when unique_violation then denied:=true; end;
  assert denied, 'Duplicate BIB must fail';
  denied:=false;
  begin perform public.save_hero_runner(-1,runner_key,draft);
  exception when invalid_parameter_value then denied:=true; end;
  assert denied, 'Wrong event must fail';
  denied:=false;
  begin perform public.save_hero_runner(event_key,runner_key,jsonb_set(draft,'{bib_number}','"QA-TRANSFER"'));
  exception when raise_exception then denied:=true; end;
  assert denied, 'Existing assigned BIB cannot change';

  draft:=jsonb_set(jsonb_set(jsonb_set(draft,'{category}','"10K"'),'{result,finish_time}','"2027-08-17T06:50:00+07:00"'),'{splits}',
    (select jsonb_agg(jsonb_build_object('km_marker',n,'split_seconds',300)) from generate_series(1,10) n));
  perform public.save_hero_runner(event_key,runner_key,draft);
  assert (select distance_km from public.runner_wrapped where runner_id=runner_key)=10, 'Atomic category movement must replace timing';
  assert (select count(*) from public.chip_splits where runner_id=runner_key)=10, 'Atomic category movement must replace splits';
  assert not has_function_privilege('anon','public.save_hero_runner(bigint,uuid,jsonb)','execute'), 'RPC must be service-only';
end $$;
rollback;
select 'organizer create/update, rollback, event scope and BIB assertions passed' as result;
