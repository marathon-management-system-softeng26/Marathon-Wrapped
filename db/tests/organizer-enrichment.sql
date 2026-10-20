begin;
do $$
declare event_key bigint; runner_key uuid; rejected boolean; draft jsonb;
begin
 select id into event_key from public.events where name='Soekarno Run 2027';
 draft:='{"name":"QA full aggregate","bib_number":"QA-ENRICHMENT","date_of_birth":"1995-01-01","gender":"F","parental_consent":false,"category":"5K","result":null,"splits":[],"enrichment":{"metrics":{"avg_heartrate":150,"max_heartrate":180,"elevation_gain_m":20,"calories":400,"avg_cadence":82},"photos":[{"photo_url":"https://example.supabase.co/storage/v1/object/public/race-photos/demo.jpg","photographer":"QA sample","captured_km":null,"captured_at":null}]}}';
 runner_key:=public.save_hero_runner(event_key,null,draft);
 assert (select avg_heartrate from public.strava_metrics where runner_id=runner_key)=150,'Full create saves demo metrics';
 assert (select data_source from public.strava_metrics where runner_id=runner_key)='demo','Must label demo metrics';
 assert (select count(*) from public.fotoyu_photos where bib_number='QA-ENRICHMENT')=1,'Full create saves exact BIB photos';
 rejected:=false;
 begin
  perform public.save_hero_runner(event_key,runner_key,jsonb_set(jsonb_set(draft,'{name}','"Should roll back"'),'{enrichment,photos,0,captured_km}','6'));
 exception when invalid_parameter_value or check_violation then rejected:=true; end;
 assert rejected,'Invalid optional photo must reject';
 assert (select name from public.runners where id=runner_key)='QA full aggregate','Late optional rejection rolls back identity';
 assert (select avg_heartrate from public.strava_metrics where runner_id=runner_key)=150,'Late rejection restores metrics';
 assert (select count(*) from public.fotoyu_photos where bib_number='QA-ENRICHMENT')=1,'Late rejection restores photos';
 perform public.save_hero_runner(event_key,runner_key,draft-'enrichment');
 assert (select count(*) from public.fotoyu_photos where bib_number='QA-ENRICHMENT')=1,'Absent enrichment preserves old callers';
 perform public.save_hero_runner(event_key,runner_key,jsonb_set(draft,'{enrichment}','{"metrics":null,"photos":[]}'));
 assert not exists(select 1 from public.strava_metrics where runner_id=runner_key),'Explicit removal clears metrics';
 assert not exists(select 1 from public.fotoyu_photos where bib_number='QA-ENRICHMENT'),'Explicit removal clears photo mappings';
 assert not has_function_privilege('authenticated','public.save_hero_runner(bigint,uuid,jsonb)','execute'),'Full RPC remains service-only';
end $$;
rollback;
