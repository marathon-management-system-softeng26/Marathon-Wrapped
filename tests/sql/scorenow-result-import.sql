begin;

do $$
begin
  if to_regclass('public.scorenow_results') is null then
    raise exception 'scorenow_results table is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.scorenow_results'::regclass) then
    raise exception 'RLS is not enabled on scorenow_results';
  end if;
  if has_table_privilege('anon', 'public.scorenow_results', 'select')
    or has_table_privilege('authenticated', 'public.scorenow_results', 'select')
    or has_table_privilege('anon', 'public.scorenow_results', 'insert')
    or has_table_privilege('authenticated', 'public.scorenow_results', 'insert') then
    raise exception 'browser roles must not access scorenow_results';
  end if;
  if has_function_privilege('anon', 'public.import_scorenow_results(jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.import_scorenow_results(jsonb)', 'execute') then
    raise exception 'browser roles must not execute import_scorenow_results';
  end if;
end
$$;

select public.import_scorenow_results('[{
  "competition_id": 999999,
  "race_id": 999999,
  "source_event_id": 1,
  "source_uid": "sql-test-result",
  "race_name": "Soekarno Run 2026",
  "race_date": "2026-02-15",
  "category": "10K",
  "position": 1,
  "bib_number": "TEST-1",
  "runner_name": "",
  "result_status": "DNF",
  "official_time": "00:30:00.000",
  "official_time_ms": 1800000,
  "source_category": "Umum",
  "category_rank": 1,
  "category_total": 1,
  "gender": "Male",
  "gender_rank": 1,
  "gender_total": 1,
  "checkpoints": [{"label":"Finish","value":"00:30:00.000"}],
  "detail_url": "https://results.scorenow.co.id/myresults.aspx?uid=sql-test-result",
  "source_url": "https://results.scorenow.co.id/results.aspx?CId=19723&RId=308&EId=1&PageNo=1",
  "scraped_at": "2026-11-19T03:00:00Z"
}]'::jsonb);

select public.import_scorenow_results('[{
  "competition_id": 999999,
  "race_id": 999999,
  "source_event_id": 1,
  "source_uid": "sql-test-result",
  "race_name": "Soekarno Run 2026",
  "race_date": "2026-02-15",
  "category": "10K",
  "position": 1,
  "bib_number": "TEST-1",
  "runner_name": "SQL Test Runner Updated",
  "result_status": "DNF",
  "official_time": "00:30:00.000",
  "official_time_ms": 1800000,
  "source_category": "Umum",
  "category_rank": 1,
  "category_total": 1,
  "gender": "Male",
  "gender_rank": 1,
  "gender_total": 1,
  "checkpoints": [{"label":"Finish","value":"00:30:00.000"}],
  "detail_url": "https://results.scorenow.co.id/myresults.aspx?uid=sql-test-result",
  "source_url": "https://results.scorenow.co.id/results.aspx?CId=19723&RId=308&EId=1&PageNo=1",
  "scraped_at": "2026-11-19T03:00:00Z"
}]'::jsonb);

select public.import_scorenow_results(jsonb_build_array(
  (select to_jsonb(result) || jsonb_build_object(
    'source_uid', 'sql-swap-result',
    'position', 2,
    'detail_url', 'https://results.scorenow.co.id/myresults.aspx?uid=sql-swap-result'
  )
  from public.scorenow_results result
  where source_uid = 'sql-test-result')
));

-- Corrected source rankings can swap positions across separate import batches.
select public.import_scorenow_results(jsonb_build_array(
  (select to_jsonb(result) || jsonb_build_object('position', 2)
   from public.scorenow_results result where source_uid = 'sql-test-result')
));
select public.import_scorenow_results(jsonb_build_array(
  (select to_jsonb(result) || jsonb_build_object('position', 1)
   from public.scorenow_results result where source_uid = 'sql-swap-result')
));

do $$
begin
  if (select count(*) from public.scorenow_results where source_uid = 'sql-test-result') <> 1 then
    raise exception 'idempotent import created duplicate source rows';
  end if;
  if (select runner_name from public.scorenow_results where source_uid = 'sql-test-result') <> 'SQL Test Runner Updated' then
    raise exception 'idempotent import did not update the existing row';
  end if;
  if (select result_status from public.scorenow_results where source_uid = 'sql-test-result') <> 'DNF' then
    raise exception 'result status was not preserved';
  end if;
  if (select count(distinct position) from public.scorenow_results where source_uid in ('sql-test-result', 'sql-swap-result')) <> 2 then
    raise exception 'corrected position swap did not converge';
  end if;
end
$$;

rollback;
