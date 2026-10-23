create function public.save_hero_runner(p_event_id bigint, p_runner_id uuid, p_draft jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  category_key bigint; runner_key uuid; distance numeric; result jsonb;
  started timestamptz; finished timestamptz; elapsed int; is_finisher boolean;
begin
  select id,distance_km into category_key,distance from public.categories
    where event_id=p_event_id and name=p_draft->>'category';
  if category_key is null then raise exception using errcode='22023', message='Invalid event/category'; end if;
  if p_runner_id is not null then
    perform 1 from public.runners r join public.categories c on c.id=r.category_id
      where r.id=p_runner_id and c.event_id=p_event_id for update of r;
    if not found then raise exception using errcode='P0002', message='Runner is not in this event'; end if;
    -- Deletion/replacement remains inside this atomic function. Any later error
    -- restores the original aggregate, including these dependent records.
    delete from public.chip_splits where runner_id=p_runner_id;
    delete from public.chip_results where runner_id=p_runner_id;
    update public.runners set category_id=category_key,name=p_draft->>'name',bib_number=p_draft->>'bib_number',
      date_of_birth=(p_draft->>'date_of_birth')::date,gender=p_draft->>'gender',
      parental_consent=(p_draft->>'parental_consent')::boolean where id=p_runner_id returning id into runner_key;
  else
    runner_key:=gen_random_uuid();
    insert into public.runners(id,category_id,name,bib_number,date_of_birth,gender,parental_consent,email,phone,id_type,id_number,jersey_size)
    values(runner_key,category_key,p_draft->>'name',p_draft->>'bib_number',(p_draft->>'date_of_birth')::date,
      p_draft->>'gender',(p_draft->>'parental_consent')::boolean,'demo+'||runner_key::text||'@example.test',
      '0000000000','Student ID','DEMO-'||runner_key::text,'M');
  end if;
  result:=p_draft->'result';
  if result is not null and result<>'null'::jsonb then
    started:=(result->>'start_time')::timestamptz;
    finished:=(result->>'finish_time')::timestamptz;
    is_finisher:=(result->>'finisher')::boolean;
    elapsed:=case when is_finisher then round(extract(epoch from (finished-started)))::int end;
    insert into public.chip_results(runner_id,start_status,start_time,finish_time,elapsed_seconds,avg_pace_sec_km,finisher)
      values(runner_key,result->>'start_status',started,finished,elapsed,elapsed/distance,is_finisher);
    insert into public.chip_splits(runner_id,km_marker,split_seconds)
      select runner_key,(x->>'km_marker')::int,(x->>'split_seconds')::numeric from jsonb_array_elements(p_draft->'splits') x;
    if is_finisher and ((select count(*) from public.chip_splits where runner_id=runner_key)<>distance
      or abs((select sum(split_seconds) from public.chip_splits where runner_id=runner_key)-elapsed)>1) then
      raise exception using errcode='22023', message='Finisher requires complete consistent splits';
    end if;
  elsif jsonb_array_length(p_draft->'splits')<>0 then
    raise exception using errcode='22023', message='Missing result cannot have splits';
  end if;
  return runner_key;
end $$;
revoke execute on function public.save_hero_runner(bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_hero_runner(bigint,uuid,jsonb) to service_role;
