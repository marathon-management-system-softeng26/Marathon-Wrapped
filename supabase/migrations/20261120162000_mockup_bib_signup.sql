-- Mockup activation for the browser demo.
-- BIB is the demo credential; the submitted email is only used to create a
-- Supabase Auth account and is deliberately not matched to a roster.

create table public.bib_registration_tickets (
  ticket_hash text primary key check (ticket_hash ~ '^[0-9a-f]{64}$'),
  accepted_ticket_hash text unique check (accepted_ticket_hash is null or accepted_ticket_hash ~ '^[0-9a-f]{64}$'),
  event_id bigint not null references public.events(id) on delete cascade,
  runner_id uuid not null references public.runners(id) on delete cascade,
  state text not null check (state in ('looked_up','accepted','reserved','finalized','revoked')),
  email text,
  expires_at timestamptz not null,
  reservation_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  accepted_at timestamptz,
  finalized_at timestamptz
);

create index bib_registration_tickets_runner on public.bib_registration_tickets(runner_id, state);
create index bib_registration_tickets_expiry on public.bib_registration_tickets(expires_at);

create table public.bib_request_rate_limits (
  bucket text not null check (bucket in ('lookup','submission')),
  bucket_key text not null,
  window_started_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0 check (attempts >= 0),
  primary key (bucket,bucket_key)
);

alter table public.bib_registration_tickets enable row level security;
alter table public.bib_request_rate_limits enable row level security;
revoke all on public.bib_registration_tickets, public.bib_request_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.bib_registration_tickets, public.bib_request_rate_limits to service_role;

create function public.consume_bib_rate_limit(p_bucket text, p_key text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare current_count integer;
begin
  insert into public.bib_request_rate_limits(bucket,bucket_key) values (p_bucket,p_key)
    on conflict (bucket,bucket_key) do nothing;
  update public.bib_request_rate_limits
    set attempts = case when window_started_at <= clock_timestamp() - interval '15 minutes' then 1 else attempts + 1 end,
        window_started_at = case when window_started_at <= clock_timestamp() - interval '15 minutes' then clock_timestamp() else window_started_at end
    where bucket=p_bucket and bucket_key=p_key
    returning attempts into current_count;
  return current_count <= case when p_bucket='lookup' then 30 else 10 end;
end $$;

create function public.lookup_published_bib(p_event_id bigint,p_bib text,p_ticket_hash text)
returns table(bib text,name text,distance text) language plpgsql security invoker set search_path='' as $$
declare target uuid;
begin
  if p_ticket_hash !~ '^[0-9a-f]{64}$' then return; end if;
  select r.runner_id into target
    from public.official_race_results r
    join public.events e on e.id=r.event_id
    where r.event_id=p_event_id and upper(r.bib)=upper(btrim(p_bib)) and e.bib_signup_enabled
    limit 1;
  if target is null then return; end if;
  insert into public.bib_registration_tickets(ticket_hash,event_id,runner_id,state,expires_at)
    select p_ticket_hash,p_event_id,target,'looked_up',clock_timestamp()+interval '15 minutes'
    where not exists (select 1 from public.bib_registration_tickets where ticket_hash=p_ticket_hash);
  return query select r.bib,r.name,r.distance from public.official_race_results r where r.runner_id=target;
end $$;

create function public.accept_bib_ticket(p_ticket_hash text,p_accepted_ticket_hash text)
returns timestamptz language plpgsql security invoker set search_path='' as $$
declare deadline timestamptz;
begin
  update public.bib_registration_tickets
    set accepted_ticket_hash=p_accepted_ticket_hash,state='accepted',accepted_at=clock_timestamp()
    where ticket_hash=p_ticket_hash and state='looked_up' and expires_at>clock_timestamp()
    returning expires_at into deadline;
  return deadline;
end $$;

create function public.revoke_bib_ticket(p_ticket_hash text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  update public.bib_registration_tickets set state='revoked'
    where (ticket_hash=p_ticket_hash or accepted_ticket_hash=p_ticket_hash)
      and state in ('looked_up','accepted');
  return found;
end $$;

create function public.begin_bib_signup(p_ticket_hash text,p_email text)
returns text language plpgsql security invoker set search_path='' as $$
declare target uuid;
begin
  select runner_id into target from public.bib_registration_tickets
    where accepted_ticket_hash=p_ticket_hash and state='accepted' and expires_at>clock_timestamp()
    for update;
  if target is null then return 'unavailable'; end if;
  if exists(select 1 from public.runner_access where runner_id=target) then return 'unavailable'; end if;
  update public.bib_registration_tickets
    set state='reserved',email=lower(btrim(p_email)),reservation_expires_at=clock_timestamp()+interval '24 hours'
    where accepted_ticket_hash=p_ticket_hash;
  return 'reserved';
end $$;

create function public.finalize_bib_signup(p_user_id uuid)
returns uuid[] language plpgsql security invoker set search_path='' as $$
declare linked uuid[] := '{}'; item record;
begin
  for item in select * from public.bib_registration_tickets
    where state='reserved' and reservation_expires_at>clock_timestamp() order by created_at for update
  loop
    begin
      insert into public.runner_access(user_id,runner_id) values (p_user_id,item.runner_id)
        on conflict (runner_id) do nothing;
      if exists(select 1 from public.runner_access where user_id=p_user_id and runner_id=item.runner_id) then
        update public.bib_registration_tickets set state='finalized',finalized_at=clock_timestamp() where ticket_hash=item.ticket_hash;
        linked := array_append(linked,item.runner_id);
      end if;
    exception when unique_violation then null;
    end;
  end loop;
  return linked;
end $$;

create function public.link_accepted_bib(p_user_id uuid,p_ticket_hash text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare target uuid;
begin
  select runner_id into target from public.bib_registration_tickets
    where accepted_ticket_hash=p_ticket_hash and state in ('accepted','reserved')
      and coalesce(reservation_expires_at,expires_at)>clock_timestamp() for update;
  if target is null then return null; end if;
  insert into public.runner_access(user_id,runner_id) values (p_user_id,target) on conflict (runner_id) do nothing;
  if not exists(select 1 from public.runner_access where user_id=p_user_id and runner_id=target) then return null; end if;
  update public.bib_registration_tickets set state='finalized',finalized_at=clock_timestamp() where accepted_ticket_hash=p_ticket_hash;
  return target;
end $$;

revoke execute on function public.consume_bib_rate_limit(text,text),public.lookup_published_bib(bigint,text,text),public.accept_bib_ticket(text,text),public.revoke_bib_ticket(text),public.begin_bib_signup(text,text),public.finalize_bib_signup(uuid),public.link_accepted_bib(uuid,text) from public,anon,authenticated;
grant execute on function public.consume_bib_rate_limit(text,text),public.lookup_published_bib(bigint,text,text),public.accept_bib_ticket(text,text),public.revoke_bib_ticket(text),public.begin_bib_signup(text,text),public.finalize_bib_signup(uuid),public.link_accepted_bib(uuid,text) to service_role;

-- Seed one believable result for the hosted mockup so the browser journey is visible.
do $$
declare run_id uuid := gen_random_uuid();
begin
  update public.events set bib_signup_enabled=true,scorenow_competition_id=999001,scorenow_race_id=999002 where id=1;
  insert into public.scorenow_import_runs(id,event_id,competition_id,race_id,manifest_digest,parser_version,manifest,missing_details_reviewed,identity_changes_reviewed,published_at)
    values(run_id,1,999001,999002,repeat('a',64),'mockup-1',jsonb_build_object('distances',jsonb_build_object('5K',jsonb_build_object('advertisedTotal',1,'pageCount',1),'10K',jsonb_build_object('advertisedTotal',1,'pageCount',1))),true,true,clock_timestamp())
    on conflict (event_id,manifest_digest) do nothing;
  select id into run_id from public.scorenow_import_runs where event_id=1 and manifest_digest=repeat('a',64);
  insert into public.official_race_results(runner_id,event_id,bib,name,distance,gender,division,status,finish_time_ms,net_time_ms,overall_rank,division_rank,gender_rank,source_uid,source_url,published_at,published_run_id)
    select r.id,1,r.bib_number,r.name,case when c.name='5K' then '5K' else '10K' end,r.gender,c.name,'finished',case when c.name='5K' then 1645000 else 3312000 end,case when c.name='5K' then 1639000 else 3298000 end,1,1,1,'mock-'||r.bib_number,'https://results.scorenow.co.id/mockup',clock_timestamp(),run_id
      from public.runners r join public.categories c on c.id=r.category_id where r.bib_number in ('HERO-5K-001','HERO-10K-001')
    on conflict (runner_id) do update set published_run_id=excluded.published_run_id,published_at=excluded.published_at;
end $$;
