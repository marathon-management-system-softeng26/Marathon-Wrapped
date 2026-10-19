-- Synthetic demonstration data only. Re-running updates the same BIB fixtures.
-- August 17 is a demo date, not a claim about the real event schedule.
begin;
do $$
declare
  event_key bigint;
  category_key bigint;
  runner_key uuid;
  fixture record;
  seconds_total int;
  gun timestamptz := '2027-08-17 06:00:00+07';
begin
  select id into event_key from public.events where name='Soekarno Run 2027' and event_date='2027-08-17' limit 1;
  if event_key is null then
    insert into public.events(name,event_date,location) values ('Soekarno Run 2027','2027-08-17','Jakarta (demo)') returning id into event_key;
  end if;
  insert into public.categories(event_id,name,distance_km,min_age) values
    (event_key,'5K',5,13),(event_key,'10K',10,17)
    on conflict(event_id,name) do update set distance_km=excluded.distance_km,min_age=excluded.min_age;
  for fixture in select * from (values
    ('HERO-5K-001','Aina Putri','5K','F','on-time',true,array[312,305,318,298,290]),
    ('HERO-10K-001','Budi Santoso','10K','M','on-time',true,array[340,338,336,334,332,350,355,360,365,370]),
    ('HERO-10K-002','Sari Dewi','10K','F','late',true,array[330,325,320,315,310,305,300,295,290,285]),
    ('EDGE-DNF','Citra Lestari','5K','F','on-time',false,array[320,330]),
    ('EDGE-DNS','Dewa Ngurah','10K','M','dns',false,array[]::int[]),
    ('EDGE-NO-STRAVA','Fajar Pratama','5K','M','on-time',true,array[330,330,330,330,330]),
    ('EDGE-NO-PHOTOS','Rani Kusuma','10K','F','on-time',true,array[360,360,360,360,360,360,360,360,360,360]),
    ('EDGE-NO-RESULT','Adi Wijaya','5K','M','on-time',false,array[]::int[])
  ) as data(bib,name,category,gender,start_status,finisher,splits)
  loop
    select id into category_key from public.categories where event_id=event_key and name=fixture.category;
    insert into public.runners(category_id,bib_number,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
      values (category_key,fixture.bib,fixture.name,'1995-04-12',fixture.gender,
        lower(fixture.bib)||'@example.test','0000000000','Student ID','DEMO-'||fixture.bib,'M')
      on conflict(bib_number) do update set name=excluded.name,gender=excluded.gender
      returning id into runner_key;
    if fixture.bib='EDGE-NO-RESULT' then continue; end if;
    select sum(s)::int into seconds_total from unnest(fixture.splits) s;
    insert into public.chip_results(runner_id,start_status,start_time,finish_time,elapsed_seconds,avg_pace_sec_km,finisher)
      values (runner_key,fixture.start_status,case when fixture.start_status='dns' then null else gun end,
        case when fixture.finisher then gun+make_interval(secs=>seconds_total) end,
        case when fixture.finisher then seconds_total end,
        case when fixture.finisher then seconds_total::numeric/(case when fixture.category='5K' then 5 else 10 end) end,
        fixture.finisher)
      on conflict(runner_id) do update set start_status=excluded.start_status,start_time=excluded.start_time,
        finish_time=excluded.finish_time,elapsed_seconds=excluded.elapsed_seconds,
        avg_pace_sec_km=excluded.avg_pace_sec_km,finisher=excluded.finisher,category_rank=null,overall_rank=null;
    insert into public.chip_splits(runner_id,km_marker,split_seconds)
      select runner_key,n,s from unnest(fixture.splits) with ordinality as parts(s,n)
      on conflict(runner_id,km_marker) do update set split_seconds=excluded.split_seconds;
    if fixture.bib like 'HERO-%' then
      insert into public.strava_metrics(runner_id,avg_heartrate,max_heartrate,elevation_gain_m,calories,avg_cadence,data_source)
        values (runner_key,150,178,32.5,410,84,'demo')
        on conflict(runner_id) do nothing;
    end if;
  end loop;
end $$;
commit;
