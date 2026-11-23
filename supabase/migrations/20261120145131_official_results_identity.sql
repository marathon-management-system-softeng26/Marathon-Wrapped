alter table public.events
  add column bib_signup_enabled boolean not null default false,
  add column scorenow_competition_id bigint,
  add column scorenow_race_id bigint,
  add constraint events_scorenow_edition_pair check (
    (scorenow_competition_id is null and scorenow_race_id is null)
    or (scorenow_competition_id is not null and scorenow_competition_id > 0
      and scorenow_race_id is not null and scorenow_race_id > 0)
  ),
  add constraint events_scorenow_edition_key unique (scorenow_competition_id, scorenow_race_id);

alter table public.categories add constraint categories_id_event_key unique (id, event_id);

alter table public.runners
  add column event_id bigint,
  add column source_kind text not null default 'legacy' check (source_kind in ('legacy', 'scorenow'));

update public.runners r set event_id=c.event_id
  from public.categories c where c.id=r.category_id;

alter table public.runners
  alter column event_id set not null,
  alter column date_of_birth drop not null,
  alter column gender drop not null,
  alter column email drop not null,
  alter column phone drop not null,
  alter column id_type drop not null,
  alter column id_number drop not null,
  alter column jersey_size drop not null,
  add constraint runners_category_event_fkey foreign key (category_id,event_id)
    references public.categories(id,event_id) on delete cascade,
  add constraint runners_id_event_key unique (id,event_id),
  add constraint runners_event_bib_key unique (event_id,bib_number),
  add constraint runners_registration_fields check (
    source_kind <> 'legacy' or (
      date_of_birth is not null and gender is not null and email is not null and phone is not null
      and id_type is not null and id_number is not null and jersey_size is not null
    )
  );

alter table public.runners drop constraint runners_category_id_fkey;

create unique index runners_event_bib_upper on public.runners(event_id,upper(bib_number));
-- Legacy BIB-only callers still need one unambiguous legacy registration.
drop index public.runners_bib_upper;
create unique index runners_bib_upper on public.runners(upper(bib_number)) where source_kind='legacy';

create function public.default_runner_event() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.event_id is null then
    select event_id into new.event_id from public.categories where id=new.category_id;
  end if;
  return new;
end $$;

create trigger runners_default_event before insert on public.runners
  for each row execute function public.default_runner_event();

create or replace function public.check_runner_eligibility() returns trigger
language plpgsql set search_path='' as $$
declare
  race_date date;
  cat_min integer;
  runner_age integer;
begin
  if new.source_kind='scorenow' then return new; end if;
  select e.event_date,c.min_age into race_date,cat_min
  from public.categories c join public.events e on e.id=c.event_id
  where c.id=new.category_id;
  runner_age := public.age_on(new.date_of_birth,race_date);
  if runner_age < cat_min then
    raise exception 'Runner % is % on race day; the minimum age for this category is %',
      new.name,runner_age,cat_min;
  end if;
  if runner_age < 17 and not new.parental_consent then
    raise exception 'Runner % is under 17 and needs parental consent',new.name;
  end if;
  return new;
end $$;

drop trigger runners_eligibility on public.runners;
create trigger runners_eligibility
  before insert or update of category_id,date_of_birth,parental_consent,source_kind on public.runners
  for each row execute function public.check_runner_eligibility();

create or replace function public.lock_bib_number() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.source_kind='legacy' and old.bib_number is not null
    and new.bib_number is distinct from old.bib_number then
    raise exception 'BIB % is non-transferable and cannot be changed',old.bib_number;
  end if;
  return new;
end $$;

alter table public.fotoyu_photos add column runner_id uuid;
update public.fotoyu_photos p set runner_id=r.id
  from public.runners r where p.bib_number=r.bib_number;

alter table public.fotoyu_photos
  alter column runner_id set not null,
  alter column bib_number drop not null,
  drop constraint fotoyu_photos_bib_number_fkey,
  add constraint fotoyu_photos_runner_fkey foreign key (runner_id)
    references public.runners(id) on delete cascade;
create index fotoyu_photos_runner_id on public.fotoyu_photos(runner_id);

create function public.resolve_photo_runner() returns trigger
language plpgsql set search_path='' as $$
declare
  matched public.runners%rowtype;
begin
  if new.runner_id is null then
    select * into matched from public.runners where bib_number=new.bib_number and source_kind='legacy';
  else
    select * into matched from public.runners where id=new.runner_id;
  end if;
  if not found then
    raise exception using errcode='23503',message='Photo requires an existing runner';
  end if;
  if new.bib_number is not null and (
    matched.source_kind <> 'legacy' or new.bib_number is distinct from matched.bib_number
  ) then
    raise exception using errcode='23503',message='Photo BIB does not match its legacy runner';
  end if;
  new.runner_id := matched.id;
  new.bib_number := case when matched.source_kind='legacy' then matched.bib_number end;
  return new;
end $$;

create trigger fotoyu_photos_resolve_runner before insert or update of runner_id,bib_number on public.fotoyu_photos
  for each row execute function public.resolve_photo_runner();

alter table public.runners drop constraint runners_bib_number_key;

create or replace view public.runner_wrapped with (security_invoker=true) as
with ranked as (
  select cr.runner_id,
    rank() over (partition by r.category_id order by cr.elapsed_seconds)::int as category_rank,
    rank() over (partition by c.event_id,c.distance_km order by cr.elapsed_seconds)::int as overall_rank,
    percent_rank() over (partition by r.category_id order by cr.elapsed_seconds desc) as category_percentile
  from public.chip_results cr join public.runners r on r.id=cr.runner_id
  join public.categories c on c.id=r.category_id where cr.finisher
)
select r.id as runner_id,r.bib_number,r.name,r.gender,
  public.age_on(r.date_of_birth,e.event_date) as age,
  e.name as event,c.name as category,c.distance_km,
  cr.start_status,cr.elapsed_seconds,cr.avg_pace_sec_km,
  rk.category_rank,rk.overall_rank,cr.finisher,rk.category_percentile,
  sm.avg_heartrate,sm.max_heartrate,sm.elevation_gain_m,sm.calories,sm.avg_cadence,
  (sm.runner_id is not null) as has_strava,
  (select count(*) from public.fotoyu_photos fp where fp.runner_id=r.id) as photo_count
from public.runners r join public.categories c on c.id=r.category_id
join public.events e on e.id=c.event_id
join public.chip_results cr on cr.runner_id=r.id
left join ranked rk on rk.runner_id=r.id
left join public.strava_metrics sm on sm.runner_id=r.id;

create table public.official_race_results (
  runner_id uuid primary key,
  event_id bigint not null,
  bib text not null check (bib=btrim(bib) and bib<>''),
  name text not null,
  distance text not null check (distance in ('5K','10K')),
  gender text,
  division text,
  status text not null check (status in ('finished','dnf','dns','dq','unknown')),
  finish_time_ms bigint check (finish_time_ms >= 0),
  net_time_ms bigint check (net_time_ms >= 0),
  overall_rank integer check (overall_rank > 0),
  division_rank integer check (division_rank > 0),
  gender_rank integer check (gender_rank > 0),
  source_uid text check (source_uid=btrim(source_uid) and source_uid<>''),
  source_url text,
  published_at timestamptz not null default now(),
  constraint official_race_results_runner_event_fkey foreign key (runner_id,event_id)
    references public.runners(id,event_id) on delete cascade,
  constraint official_race_results_source_key unique (event_id,source_uid)
);

create unique index official_race_results_event_bib on public.official_race_results(event_id,upper(bib));

create table public.official_race_checkpoints (
  runner_id uuid not null references public.official_race_results(runner_id) on delete cascade,
  sequence integer not null check (sequence > 0),
  label text not null check (btrim(label)<>''),
  distance_meters integer check (distance_meters >= 0),
  displayed_time_ms bigint check (displayed_time_ms >= 0),
  reported_split_ms bigint check (reported_split_ms >= 0),
  reference_label text,
  primary key (runner_id,sequence)
);

alter table public.official_race_results enable row level security;
alter table public.official_race_checkpoints enable row level security;
revoke all on public.official_race_results,public.official_race_checkpoints from public,anon,authenticated;
grant select,insert,update,delete on public.official_race_results,public.official_race_checkpoints to service_role;
revoke execute on function public.default_runner_event(),public.resolve_photo_runner() from public,anon,authenticated;
grant execute on function public.default_runner_event(),public.resolve_photo_runner() to service_role;

create table public.official_result_roster (
  runner_id uuid primary key,
  event_id bigint not null,
  email text not null,
  foreign key (runner_id,event_id) references public.runners(id,event_id) on delete cascade
);
alter table public.official_result_roster enable row level security;
revoke all on public.official_result_roster from public, anon, authenticated;
grant select, insert, update, delete on public.official_result_roster to service_role;

-- Older BIB-only RPCs can operate only on the legacy registration pool.
create or replace function public.link_runner_by_bib(p_user uuid, p_bib text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  rejections int;
  target uuid;
  owner_id uuid;
begin
  if p_user is null or p_bib is null or btrim(p_bib) !~ '^[A-Za-z0-9-]{1,40}$' then
    return 'unavailable';
  end if;

  -- Retention: keep only what the throttle below can still read. A malformed entry returns above
  -- without reaching this, so it neither records nor prunes anything.
  delete from public.bib_link_attempts
    where user_id = p_user and attempted_at <= clock_timestamp() - interval '15 minutes';

  -- Bound how fast one account can walk the BIB space. Successful links do not count: a runner
  -- with several registrations is not the behaviour being limited.
  select count(*) into rejections from public.bib_link_attempts
    where user_id = p_user and outcome = 'rejected'
      and attempted_at > clock_timestamp() - interval '15 minutes';
  if rejections >= 6 then
    return 'throttled';
  end if;

  -- At most one row can match now that the folded value is unique, so this both selects and
  -- locks exactly the contested registration.
  select r.id into target from public.runners r join public.events e on e.id=r.event_id
    where upper(r.bib_number) = upper(btrim(p_bib)) and r.source_kind='legacy' 
      and e.scorenow_competition_id is null for update of r;
  if target is null then
    insert into public.bib_link_attempts(user_id, outcome) values (p_user, 'rejected');
    return 'unavailable';
  end if;

  select ra.user_id into owner_id from public.runner_access ra
    where ra.runner_id = target for share;
  if owner_id is not null then
    if owner_id = p_user then
      insert into public.bib_link_attempts(user_id, outcome) values (p_user, 'linked');
      return 'already_yours';
    end if;
    -- An owned registration is reported exactly like an absent one, so a response never
    -- confirms which BIBs exist.
    insert into public.bib_link_attempts(user_id, outcome) values (p_user, 'rejected');
    return 'unavailable';
  end if;

  insert into public.runner_access(user_id, runner_id) values (p_user, target)
    on conflict (runner_id) do nothing;
  select ra.user_id into owner_id from public.runner_access ra
    where ra.runner_id = target for share;
  if owner_id is distinct from p_user then
    insert into public.bib_link_attempts(user_id, outcome) values (p_user, 'rejected');
    return 'unavailable';
  end if;

  insert into public.bib_link_attempts(user_id, outcome) values (p_user, 'linked');
  return 'linked';
exception when foreign_key_violation then
  -- A missing or deleted Auth user cannot take a registration; this subtransaction also rolls
  -- back any ownership insert whose attempt record then fails.
  return 'unavailable';
end $$;

-- 3. Giving a registration back. Only the holder can, and only their own ownership row is
--    touched. Every dependent Strava row -- attachment, candidate, activity, snapshot and live
--    metric -- cascades from this delete, so a released registration carries no private data
--    forward to whoever takes it next.
create or replace function public.release_runner_by_bib(p_user uuid, p_bib text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  target uuid;
begin
  if p_user is null or p_bib is null or btrim(p_bib) !~ '^[A-Za-z0-9-]{1,40}$' then
    return 'unavailable';
  end if;

  select r.id into target from public.runners r join public.events e on e.id=r.event_id
    where upper(r.bib_number) = upper(btrim(p_bib)) and r.source_kind='legacy' 
      and e.scorenow_competition_id is null for update of r;
  if target is null then
    return 'unavailable';
  end if;

  delete from public.runner_access where runner_id = target and user_id = p_user;
  if not found then
    -- A registration held by someone else is reported exactly like an absent one. Releasing is
    -- therefore never an oracle for which BIBs exist or who holds them.
    return 'unavailable';
  end if;
  return 'released';
end $$;

revoke execute on function public.release_runner_by_bib(uuid,text) from public, anon, authenticated;
grant execute on function public.release_runner_by_bib(uuid,text) to service_role;
revoke execute on function public.link_runner_by_bib(uuid,text) from public, anon, authenticated;
grant execute on function public.link_runner_by_bib(uuid,text) to service_role;


-- Organizer photos use the same UUID as their aggregate.
create or replace function public.save_hero_runner(p_event_id bigint,p_runner_id uuid,p_draft jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare runner_key uuid; distance numeric; enrichment jsonb; metrics jsonb;
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
 select c.distance_km into distance from public.runners r join public.categories c on c.id=r.category_id where r.id=runner_key;
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
 delete from public.fotoyu_photos where runner_id=runner_key;
 for photo in select * from jsonb_array_elements(enrichment->'photos') loop
  if jsonb_typeof(photo)<>'object' or photo->>'photo_url' is null
   or length(photo->>'photo_url')>2048
   or photo->>'photo_url' !~ '^https://[a-z0-9]+[.]supabase[.]co/storage/v1/object/public/race-photos/[^?#]+$'
   or length(photo->>'photographer')>200
   or (photo->>'captured_km')::numeric not between 0 and distance then
   raise exception using errcode='22023',message='Invalid sample photo';
  end if;
  insert into public.fotoyu_photos(runner_id,photo_url,photographer,captured_km,captured_at)
   values(runner_key,photo->>'photo_url',photo->>'photographer',(photo->>'captured_km')::int,(photo->>'captured_at')::timestamptz);
 end loop;
 return runner_key;
end $$;
revoke execute on function public.save_hero_runner(bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_hero_runner(bigint,uuid,jsonb) to service_role;
revoke execute on function public.save_hero_runner_chip(bigint,uuid,jsonb) from public,anon,authenticated;

