-- Read-only assertions against the dedicated migrated/seeded demo database.
do $$
declare count_rows int;
begin
  select count(*) into count_rows from public.events where name='Soekarno Run 2027';
  assert count_rows=1, 'Expected one repeatable Soekarno demo event';
  select count(*) into count_rows from public.runners where bib_number like 'HERO-%';
  assert count_rows>=3, 'Expected at least three hero chip fixtures';
  assert not exists (select 1 from public.runners r join public.categories c on c.id=r.category_id
    join public.chip_results cr on cr.runner_id=r.id where cr.finisher
    and (select count(*) from public.chip_splits s where s.runner_id=r.id)<>c.distance_km), 'Incomplete finisher splits';
  assert exists (select 1 from public.runners r left join public.chip_results cr on cr.runner_id=r.id
    where r.bib_number='EDGE-NO-RESULT' and cr.id is null), 'Missing result fixture absent';
  assert exists (select 1 from public.runner_wrapped where bib_number='EDGE-DNF' and not finisher
    and elapsed_seconds is null and avg_pace_sec_km is null and category_rank is null), 'Invalid DNF';
  assert exists (select 1 from public.runner_wrapped where bib_number='EDGE-DNS' and start_status='dns'
    and elapsed_seconds is null), 'DNS fixture absent';
  assert exists (select 1 from public.runner_wrapped where bib_number='EDGE-NO-STRAVA' and not has_strava), 'No Strava fixture absent';
  assert exists (select 1 from public.runner_wrapped where bib_number='EDGE-NO-PHOTOS' and photo_count=0), 'No photos fixture absent';
  assert not has_table_privilege('anon','public.runner_wrapped','select'), 'Anonymous view access';
  assert not has_table_privilege('authenticated','public.runners','select'), 'Direct registration access';
  assert exists (select 1 from pg_class where oid='public.runner_wrapped'::regclass and 'security_invoker=true'=any(reloptions)), 'Invoker view required';
end $$;
select 'core database assertions passed' as result;
