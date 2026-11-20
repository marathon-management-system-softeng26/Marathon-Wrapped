create table public.scorenow_import_runs (
  id uuid primary key default gen_random_uuid(),
  event_id bigint not null references public.events(id) on delete cascade,
  competition_id bigint not null check (competition_id > 0),
  race_id bigint not null check (race_id > 0),
  manifest_digest text not null check (manifest_digest ~ '^[0-9a-f]{64}$'),
  parser_version text not null check (btrim(parser_version)<>''),
  manifest jsonb not null check (jsonb_typeof(manifest)='object'),
  missing_details_reviewed boolean not null default false,
  identity_changes_reviewed boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  published_at timestamptz,
  unique (event_id,manifest_digest),
  unique (id,event_id)
);

create table public.scorenow_import_pages (
  run_id uuid not null references public.scorenow_import_runs(id) on delete cascade,
  distance text not null check (distance in ('5K','10K')),
  page_number integer not null check (page_number > 0),
  row_count integer not null check (row_count >= 0),
  primary key (run_id,distance,page_number)
);

create table public.scorenow_import_rows (
  run_id uuid not null,
  distance text not null,
  page_number integer not null,
  row_number integer not null check (row_number > 0),
  bib text not null check (bib=btrim(bib) and bib<>''),
  name text not null,
  gender text,
  division text,
  status text not null check (status in ('finished','dnf','dns','dq','unknown')),
  finish_time_ms bigint check (finish_time_ms >= 0),
  net_time_ms bigint check (net_time_ms >= 0),
  overall_rank integer check (overall_rank > 0),
  division_rank integer check (division_rank > 0),
  gender_rank integer check (gender_rank > 0),
  source_uid text check (source_uid=btrim(source_uid) and source_uid<>''),
  source_url text check (source_url ~ '^https://results[.]scorenow[.]co[.]id/'),
  detail_outcome text not null check (detail_outcome in ('resolved','no_link','failed')),
  detail_identity jsonb check (jsonb_typeof(detail_identity)='object'),
  checkpoints jsonb not null default '[]' check (jsonb_typeof(checkpoints)='array'),
  raw_source text check (octet_length(raw_source)<=65536),
  primary key (run_id,distance,page_number,row_number),
  foreign key (run_id,distance,page_number)
    references public.scorenow_import_pages(run_id,distance,page_number) on delete cascade
);

create index scorenow_import_rows_bib on public.scorenow_import_rows(run_id,upper(bib));
create index scorenow_import_rows_uid on public.scorenow_import_rows(run_id,source_uid);

alter table public.official_race_results
  add column published_run_id uuid not null,
  add constraint official_race_results_run_event_fkey foreign key (published_run_id,event_id)
    references public.scorenow_import_runs(id,event_id);
create index official_race_results_publish_run on public.official_race_results(published_run_id,event_id);

alter table public.scorenow_import_runs enable row level security;
alter table public.scorenow_import_pages enable row level security;
alter table public.scorenow_import_rows enable row level security;
revoke all on public.scorenow_import_runs,public.scorenow_import_pages,public.scorenow_import_rows from public,anon,authenticated;
grant select,insert,update,delete on public.scorenow_import_runs,public.scorenow_import_pages,public.scorenow_import_rows to service_role;

create function public.stage_scorenow_import_rows(p_run_id uuid,p_manifest_digest text,p_rows jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare
  affected integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or octet_length(p_rows::text)>1048576 then
    raise exception using errcode='22023',message='Expected a staged row batch within 1 MiB';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception using errcode='22023',message='Expected a staged row batch containing 1 to 100 rows';
  end if;

  perform 1 from public.scorenow_import_runs
    where id=p_run_id and manifest_digest=p_manifest_digest and published_at is null for update;
  if not found then
    raise exception using errcode='22023',message='Staging run or manifest digest does not match';
  end if;

  insert into public.scorenow_import_rows(
    run_id,distance,page_number,row_number,bib,name,gender,division,status,
    finish_time_ms,net_time_ms,overall_rank,division_rank,gender_rank,
    source_uid,source_url,detail_outcome,detail_identity,checkpoints,raw_source
  )
  select p_run_id,distance,page_number,row_number,bib,name,gender,division,status,
    finish_time_ms,net_time_ms,overall_rank,division_rank,gender_rank,
    source_uid,source_url,detail_outcome,detail_identity,coalesce(checkpoints,'[]'),raw_source
  from jsonb_to_recordset(p_rows) as r(
    distance text,page_number integer,row_number integer,bib text,name text,gender text,division text,status text,
    finish_time_ms bigint,net_time_ms bigint,overall_rank integer,division_rank integer,gender_rank integer,
    source_uid text,source_url text,detail_outcome text,detail_identity jsonb,checkpoints jsonb,raw_source text
  )
  on conflict (run_id,distance,page_number,row_number) do update
    set bib=excluded.bib,name=excluded.name,gender=excluded.gender,division=excluded.division,status=excluded.status,
      finish_time_ms=excluded.finish_time_ms,net_time_ms=excluded.net_time_ms,overall_rank=excluded.overall_rank,
      division_rank=excluded.division_rank,gender_rank=excluded.gender_rank,source_uid=excluded.source_uid,
      source_url=excluded.source_url,detail_outcome=excluded.detail_outcome,detail_identity=excluded.detail_identity,
      checkpoints=excluded.checkpoints,raw_source=excluded.raw_source;
  get diagnostics affected=row_count;
  return affected;
end $$;

create function public.publish_scorenow_import(p_run_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  import_run public.scorenow_import_runs%rowtype;
  edition public.events%rowtype;
  staged public.scorenow_import_rows%rowtype;
  previous public.official_race_results%rowtype;
  distance_key text;
  distance_manifest jsonb;
  advertised_count integer;
  advertised_pages integer;
  counts jsonb := '{}'::jsonb;
  category_key bigint;
  bib_runner uuid;
  uid_runner uuid;
  runner_key uuid;
begin
  select * into import_run from public.scorenow_import_runs where id=p_run_id for update;
  if not found then
    raise exception using errcode='22023',message='ScoreNow import run does not exist';
  end if;
  select * into edition from public.events where id=import_run.event_id for update;
  if edition.scorenow_competition_id is distinct from import_run.competition_id
    or edition.scorenow_race_id is distinct from import_run.race_id then
    raise exception using errcode='22023',message='ScoreNow import edition does not match the target event';
  end if;

  foreach distance_key in array array['5K','10K'] loop
    distance_manifest:=import_run.manifest->'distances'->distance_key;
    if coalesce(distance_manifest->>'advertisedTotal','') !~ '^[0-9]{1,8}$'
      or coalesce(distance_manifest->>'pageCount','') !~ '^[0-9]{1,8}$' then
      raise exception using errcode='22023',message='ScoreNow import must declare both distance totals and page counts';
    end if;
    advertised_count:=(distance_manifest->>'advertisedTotal')::integer;
    advertised_pages:=(distance_manifest->>'pageCount')::integer;
    counts:=counts||jsonb_build_object(distance_key,advertised_count);

    if import_run.published_at is not null then continue; end if;
    if not exists(select 1 from public.categories where event_id=edition.id and name=distance_key) then
      raise exception using errcode='22023',message='Target event is missing a ScoreNow distance';
    end if;
    if advertised_pages<1 or not exists(
      select 1 from public.scorenow_import_pages
      where run_id=p_run_id and distance=distance_key
      having count(*)=advertised_pages and min(page_number)=1 and max(page_number)=advertised_pages
        and sum(row_count)=advertised_count
    ) then
      raise exception using errcode='22023',message='ScoreNow import page coverage or advertised total is incomplete';
    end if;
  end loop;

  if import_run.published_at is not null then
    return jsonb_build_object('eventId',edition.id,'counts',counts);
  end if;
  if exists(select 1 from public.scorenow_import_runs r where r.event_id=edition.id
    and r.published_at is not null and r.created_at>import_run.created_at) then
    raise exception using errcode='22023',message='A newer ScoreNow import is already published';
  end if;
  if exists(
    select 1 from public.scorenow_import_pages p
    left join public.scorenow_import_rows r using(run_id,distance,page_number)
    where p.run_id=p_run_id
    group by p.distance,p.page_number,p.row_count
    having count(r.row_number)<>p.row_count or coalesce(max(r.row_number),0)<>p.row_count
  ) then
    raise exception using errcode='22023',message='ScoreNow import rows are incomplete for a recorded page';
  end if;
  if exists(
    select 1 from public.scorenow_import_rows r where r.run_id=p_run_id and (
      r.detail_outcome='failed'
      or (r.detail_outcome='no_link' and (
        not import_run.missing_details_reviewed or r.detail_identity is not null or r.source_url is not null
      ))
      or (r.detail_outcome='resolved' and (
        r.source_url is null
        or r.detail_identity->>'competitionId' is distinct from import_run.competition_id::text
        or r.detail_identity->>'raceId' is distinct from import_run.race_id::text
        or r.detail_identity->>'bib' is distinct from r.bib
        or r.detail_identity->>'distance' is distinct from r.distance
        or r.detail_identity->>'sourceUid' is distinct from r.source_uid
      ))
    )
  ) then
    raise exception using errcode='22023',message='ScoreNow detail is incomplete, mismatched, or pending review';
  end if;
  if exists(select 1 from public.scorenow_import_rows where run_id=p_run_id group by upper(bib) having count(*)>1)
    or exists(select 1 from public.scorenow_import_rows where run_id=p_run_id and source_uid is not null
      group by source_uid having count(*)>1) then
    raise exception using errcode='22023',message='ScoreNow import has duplicate BIBs or source identifiers';
  end if;
  if not import_run.identity_changes_reviewed and exists(
    select 1 from public.official_race_results p where p.event_id=edition.id and not exists (
      select 1 from public.scorenow_import_rows s
      where s.run_id=p_run_id and (upper(s.bib)=upper(p.bib) or s.source_uid=p.source_uid)
    )
  ) then
    raise exception using errcode='22023',message='ScoreNow import omits previously published identities and needs review';
  end if;

  for staged in
    select * from public.scorenow_import_rows where run_id=p_run_id order by distance,page_number,row_number
  loop
    select id into category_key from public.categories where event_id=edition.id and name=staged.distance;
    select id into bib_runner from public.runners where event_id=edition.id and upper(bib_number)=upper(staged.bib);
    select runner_id into uid_runner from public.official_race_results
      where event_id=edition.id and source_uid=staged.source_uid;
    if bib_runner is not null and uid_runner is not null and bib_runner<>uid_runner then
      raise exception using errcode='22023',message='ScoreNow BIB and source identifier match different runners';
    end if;
    runner_key:=coalesce(uid_runner,bib_runner);
    select * into previous from public.official_race_results where runner_id=runner_key;

    if previous.published_run_id=p_run_id then
      raise exception using errcode='22023',message='Multiple ScoreNow rows match the same existing runner';
    end if;
    if previous.runner_id is not null and not import_run.identity_changes_reviewed and (
      staged.bib is distinct from previous.bib or staged.name is distinct from previous.name
      or staged.distance is distinct from previous.distance
      or (staged.source_uid is not null and staged.source_uid is distinct from previous.source_uid)
    ) then
      raise exception using errcode='22023',message='Changed ScoreNow runner identity needs review';
    end if;

    if runner_key is null then
      insert into public.runners(category_id,event_id,bib_number,name,source_kind)
        values(category_key,edition.id,staged.bib,staged.name,'scorenow') returning id into runner_key;
    else
      update public.runners set category_id=category_key,bib_number=staged.bib,name=staged.name
        where id=runner_key and source_kind='scorenow';
    end if;

    insert into public.official_race_results(
      runner_id,event_id,bib,name,distance,gender,division,status,
      finish_time_ms,net_time_ms,overall_rank,division_rank,gender_rank,
      source_uid,source_url,published_at,published_run_id
    ) values (
      runner_key,edition.id,staged.bib,staged.name,staged.distance,staged.gender,staged.division,staged.status,
      staged.finish_time_ms,staged.net_time_ms,staged.overall_rank,staged.division_rank,staged.gender_rank,
      coalesce(staged.source_uid,previous.source_uid),staged.source_url,now(),p_run_id
    ) on conflict (runner_id) do update
      set bib=excluded.bib,name=excluded.name,distance=excluded.distance,gender=excluded.gender,division=excluded.division,
        status=excluded.status,finish_time_ms=excluded.finish_time_ms,net_time_ms=excluded.net_time_ms,
        overall_rank=excluded.overall_rank,division_rank=excluded.division_rank,gender_rank=excluded.gender_rank,
        source_uid=excluded.source_uid,source_url=excluded.source_url,published_at=excluded.published_at,
        published_run_id=excluded.published_run_id;

    delete from public.official_race_checkpoints where runner_id=runner_key;
    insert into public.official_race_checkpoints(
      runner_id,sequence,label,distance_meters,displayed_time_ms,reported_split_ms,reference_label
    )
    select runner_key,sequence,label,"distanceMeters","displayedTimeMs","reportedSplitMs","referenceLabel"
    from jsonb_to_recordset(staged.checkpoints) as c(
      sequence integer,label text,"distanceMeters" integer,"displayedTimeMs" bigint,
      "reportedSplitMs" bigint,"referenceLabel" text
    );
  end loop;

  update public.scorenow_import_runs set published_at=clock_timestamp() where id=p_run_id;
  return jsonb_build_object('eventId',edition.id,'counts',counts);
end $$;

revoke execute on function public.stage_scorenow_import_rows(uuid,text,jsonb),public.publish_scorenow_import(uuid)
  from public,anon,authenticated;
grant execute on function public.stage_scorenow_import_rows(uuid,text,jsonb),public.publish_scorenow_import(uuid)
  to service_role;
