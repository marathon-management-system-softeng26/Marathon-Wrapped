-- Keep the proven chip aggregate as a service-only helper. Both calls execute
-- inside one PostgreSQL statement/transaction; optional errors roll it all back.
alter function public.save_hero_runner(bigint,uuid,jsonb) rename to save_hero_runner_chip;
create function public.save_hero_runner(p_event_id bigint,p_runner_id uuid,p_draft jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare runner_key uuid; bib text; distance numeric; enrichment jsonb; metrics jsonb;
 photo jsonb; entry record;
begin
 runner_key:=public.save_hero_runner_chip(p_event_id,p_runner_id,p_draft);
 if not p_draft ? 'enrichment' then return runner_key; end if;
 enrichment:=p_draft->'enrichment'; metrics:=enrichment->'metrics';
 if jsonb_typeof(enrichment)<>'object' or not enrichment ? 'metrics'
   or jsonb_typeof(enrichment->'photos')<>'array'
   or jsonb_array_length(enrichment->'photos')>100 then
  raise exception using errcode='22023',message='Invalid enrichment aggregate';
 end if;
 select r.bib_number,c.distance_km into bib,distance from public.runners r join public.categories c on c.id=r.category_id where r.id=runner_key;
 if exists(select 1 from public.strava_metrics where runner_id=runner_key and data_source<>'demo') then
  raise exception using errcode='22023',message='Live provider data cannot be edited as a demo';
 end if;
 delete from public.strava_metrics where runner_id=runner_key;
 if metrics<>'null'::jsonb then
  if jsonb_typeof(metrics)<>'object' then raise exception using errcode='22023',message='Invalid sample metrics'; end if;
  for entry in select * from jsonb_each(metrics) loop
   if entry.key not in ('avg_heartrate','max_heartrate','elevation_gain_m','calories','avg_cadence')
     or jsonb_typeof(entry.value) not in ('null','number') then
    raise exception using errcode='22023',message='Invalid sample metric field';
   end if;
  end loop;
  if (metrics->>'avg_heartrate')::numeric>300 or (metrics->>'max_heartrate')::numeric>300
    or (metrics->>'avg_cadence')::numeric>300
    or (metrics->>'max_heartrate')::numeric<(metrics->>'avg_heartrate')::numeric then
   raise exception using errcode='22023',message='Invalid sample metric range';
  end if;
  insert into public.strava_metrics(runner_id,avg_heartrate,max_heartrate,elevation_gain_m,calories,avg_cadence,data_source)
  values(runner_key,(metrics->>'avg_heartrate')::int,(metrics->>'max_heartrate')::int,
   (metrics->>'elevation_gain_m')::numeric,(metrics->>'calories')::int,(metrics->>'avg_cadence')::int,'demo');
 end if;
 delete from public.fotoyu_photos where bib_number=bib;
 for photo in select * from jsonb_array_elements(enrichment->'photos') loop
  if jsonb_typeof(photo)<>'object' or photo->>'photo_url' is null
   or length(photo->>'photo_url')>2048
   or photo->>'photo_url' !~ '^https://[a-z0-9]+[.]supabase[.]co/storage/v1/object/public/race-photos/[^?#]+$'
   or length(photo->>'photographer')>200
   or (photo->>'captured_km')::numeric not between 0 and distance then
   raise exception using errcode='22023',message='Invalid sample photo';
  end if;
  insert into public.fotoyu_photos(bib_number,photo_url,photographer,captured_km,captured_at)
   values(bib,photo->>'photo_url',photo->>'photographer',(photo->>'captured_km')::int,(photo->>'captured_at')::timestamptz);
 end loop;
 return runner_key;
end $$;
revoke execute on function public.save_hero_runner(bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_hero_runner(bigint,uuid,jsonb) to service_role;
revoke execute on function public.save_hero_runner_chip(bigint,uuid,jsonb) from public,anon,authenticated;
