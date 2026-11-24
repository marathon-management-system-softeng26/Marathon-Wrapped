-- Refuse to adopt an existing bucket with a different access or upload contract.
do $$
begin
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values ('runner-photos','runner-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
  on conflict (id) do nothing;
  perform 1 from storage.buckets where id='runner-photos' and name='runner-photos'
    and public is false and file_size_limit=5242880
    and allowed_mime_types=array['image/jpeg','image/png','image/webp'] for update;
  if not found then raise exception 'Incompatible runner-photos bucket'; end if;
end $$;

create table public.runner_uploaded_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  runner_id uuid not null,
  foreign key (user_id,runner_id) references public.runner_access(user_id,runner_id) on delete cascade,
  staging_object_path text not null unique,
  ready_object_path text unique,
  input_mime_type text not null check (input_mime_type in ('image/jpeg','image/png','image/webp')),
  input_size_bytes bigint not null check (input_size_bytes between 1 and 5242880),
  ready_mime_type text check (ready_mime_type='image/webp'),
  ready_size_bytes bigint check (ready_size_bytes between 1 and 5242880),
  state text not null default 'pending' check (state in ('pending','finalizing','ready')),
  included boolean not null default true,
  reservation_expires_at timestamptz not null,
  upload_expires_at timestamptz,
  lease_id uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  ready_at timestamptz,
  check ((state='ready') = (ready_at is not null)),
  check ((state='ready') = (ready_size_bytes is not null)),
  check ((state='ready') = (ready_mime_type is not null)),
  check ((state='finalizing') = (lease_expires_at is not null)),
  -- Retain the winning lease ID on ready rows for idempotent completion.
  check ((state<>'pending') = (lease_id is not null)),
  check ((state<>'pending') = (ready_object_path is not null)),
  check (state='pending' or upload_expires_at is not null)
);
create index runner_uploaded_photos_owner on public.runner_uploaded_photos(user_id,runner_id,state,created_at);
create index runner_uploaded_photos_expiry on public.runner_uploaded_photos
  (coalesce(upload_expires_at,reservation_expires_at)) where state<>'ready';
create index runner_uploaded_photos_lease on public.runner_uploaded_photos(lease_expires_at) where state='finalizing';

create table public.runner_photo_cleanup (
  id uuid primary key default gen_random_uuid(),
  object_path text not null unique,
  object_kind text not null check (object_kind in ('staging','provisional_ready','ready')),
  not_before timestamptz not null,
  lease_id uuid,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check (attempts>=0),
  last_error_code text check (last_error_code ~ '^[a-z][a-z0-9_]{0,39}$'),
  check ((lease_id is null)=(lease_expires_at is null))
);
create index runner_photo_cleanup_due on public.runner_photo_cleanup(not_before, id);
alter table public.runner_uploaded_photos enable row level security;
alter table public.runner_photo_cleanup enable row level security;
revoke all on public.runner_uploaded_photos, public.runner_photo_cleanup from public, anon, authenticated, service_role;
grant select,insert,update,delete on public.runner_uploaded_photos, public.runner_photo_cleanup to service_role;

-- Internal helpers live outside the PostgREST-exposed schema.
create schema runner_photo_private;
revoke all on schema runner_photo_private from public, anon, authenticated;
grant usage on schema runner_photo_private to service_role;

create function runner_photo_private.lock_owner(p_user_id uuid,p_runner_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.runners where id=p_runner_id for update;
  if not found then return false; end if;
  perform 1 from public.runner_access where user_id=p_user_id and runner_id=p_runner_id for key share;
  return found;
end $$;

create function runner_photo_private.queue_object(p_path text,p_kind text,p_due timestamptz) returns void
language sql security invoker set search_path='' as $$
  insert into public.runner_photo_cleanup(object_path,object_kind,not_before)
  values (p_path,p_kind,p_due) on conflict (object_path) do nothing;
$$;

create function runner_photo_private.on_delete() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  perform runner_photo_private.queue_object(old.staging_object_path,'staging',
    coalesce(old.upload_expires_at,old.reservation_expires_at)+interval '10 minutes');
  if old.state='ready' then
    perform runner_photo_private.queue_object(old.ready_object_path,'ready',clock_timestamp());
  elsif old.state='finalizing' then
    perform runner_photo_private.queue_object(old.ready_object_path,'provisional_ready',old.lease_expires_at+interval '10 minutes');
  end if;
  return old;
end $$;
create trigger runner_uploaded_photos_delete before delete on public.runner_uploaded_photos
  for each row execute function runner_photo_private.on_delete();

-- Caller holds the runner row. Cascade deletes may race recovery, so lock the photo
-- before deciding whether to tombstone its current provisional path.
create function runner_photo_private.recover(p_runner_id uuid,p_now timestamptz) returns integer
language plpgsql security invoker set search_path='' as $$
declare photo public.runner_uploaded_photos; changed integer:=0;
begin
  for photo in select * from public.runner_uploaded_photos where runner_id=p_runner_id and state<>'ready'
    and (coalesce(upload_expires_at,reservation_expires_at)<=p_now or lease_expires_at<=p_now)
    order by id for update
  loop
    if coalesce(photo.upload_expires_at,photo.reservation_expires_at)<=p_now then
      delete from public.runner_uploaded_photos where id=photo.id;
    else
      perform runner_photo_private.queue_object(photo.ready_object_path,'provisional_ready',photo.lease_expires_at+interval '10 minutes');
      update public.runner_uploaded_photos set state='pending',ready_object_path=null,lease_id=null,lease_expires_at=null where id=photo.id;
    end if;
    changed:=changed+1;
  end loop;
  return changed;
end $$;

create function public.reserve_runner_photo_upload(p_user_id uuid,p_runner_id uuid,p_input_mime_type text,
  p_input_size_bytes bigint,p_reservation_expires_at timestamptz)
returns table(photo_id uuid,staging_object_path text) language plpgsql security invoker set search_path='' as $$
begin
  if not runner_photo_private.lock_owner(p_user_id,p_runner_id) then return; end if;
  if p_reservation_expires_at is null or not isfinite(p_reservation_expires_at)
    or p_reservation_expires_at<=clock_timestamp()+interval '2 hours'
    or p_reservation_expires_at>clock_timestamp()+interval '1 day' then
    raise exception 'Invalid reservation deadline' using errcode='22023';
  end if;
  perform runner_photo_private.recover(p_runner_id,clock_timestamp());
  if (select count(*) from public.runner_uploaded_photos where user_id=p_user_id and runner_id=p_runner_id)>=3 then return; end if;
  return query insert into public.runner_uploaded_photos as p(user_id,runner_id,input_mime_type,input_size_bytes,staging_object_path,reservation_expires_at)
    values(p_user_id,p_runner_id,p_input_mime_type,p_input_size_bytes,
      'staging/'||gen_random_uuid()||'/'||gen_random_uuid()||'.upload',p_reservation_expires_at)
    returning p.id,p.staging_object_path;
end $$;

create function public.activate_runner_photo_upload(p_user_id uuid,p_runner_id uuid,p_photo_id uuid,p_upload_expires_at timestamptz)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if not runner_photo_private.lock_owner(p_user_id,p_runner_id) then return false; end if;
  update public.runner_uploaded_photos set upload_expires_at=p_upload_expires_at
    where user_id=p_user_id and runner_id=p_runner_id and id=p_photo_id and state='pending'
      and upload_expires_at is null and p_upload_expires_at>clock_timestamp() and p_upload_expires_at<=reservation_expires_at
      and p_upload_expires_at<=clock_timestamp()+interval '2 hours 1 minute';
  return found;
end $$;

create function public.prepare_runner_photo_ready(p_user_id uuid,p_runner_id uuid,p_photo_id uuid,p_lease_expires_at timestamptz)
returns table(ready_object_path text,lease_id uuid,lease_expires_at timestamptz)
language plpgsql security invoker set search_path='' as $$
begin
  if not runner_photo_private.lock_owner(p_user_id,p_runner_id) then return; end if;
  perform runner_photo_private.recover(p_runner_id,clock_timestamp());
  return query update public.runner_uploaded_photos as p set state='finalizing',
    ready_object_path='ready/'||gen_random_uuid()||'/'||gen_random_uuid()||'.webp',
    lease_id=gen_random_uuid(),lease_expires_at=p_lease_expires_at
    where p.user_id=p_user_id and p.runner_id=p_runner_id and p.id=p_photo_id and p.state='pending'
      and p.upload_expires_at>clock_timestamp() and p_lease_expires_at>clock_timestamp()
      and p_lease_expires_at<=clock_timestamp()+interval '15 minutes'
    returning p.ready_object_path,p.lease_id,p.lease_expires_at;
end $$;

create function public.finalize_runner_photo_upload(p_user_id uuid,p_runner_id uuid,p_photo_id uuid,
  p_ready_object_path text,p_lease_id uuid,p_ready_size_bytes bigint)
returns boolean language plpgsql security invoker set search_path='' as $$
declare photo public.runner_uploaded_photos;
begin
  if not runner_photo_private.lock_owner(p_user_id,p_runner_id) then return false; end if;
  select * into photo from public.runner_uploaded_photos where user_id=p_user_id and runner_id=p_runner_id and id=p_photo_id
    and ready_object_path=p_ready_object_path and lease_id=p_lease_id for update;
  if not found or p_ready_size_bytes is null or p_ready_size_bytes not between 1 and 5242880 then return false; end if;
  if photo.state='ready' then return photo.ready_size_bytes=p_ready_size_bytes; end if;
  if photo.lease_expires_at<=clock_timestamp() or photo.upload_expires_at<=clock_timestamp() then return false; end if;
  update public.runner_uploaded_photos set state='ready',ready_mime_type='image/webp',ready_size_bytes=p_ready_size_bytes,
    ready_at=clock_timestamp(),lease_expires_at=null where id=photo.id;
  perform runner_photo_private.queue_object(photo.staging_object_path,'staging',photo.upload_expires_at+interval '10 minutes');
  return true;
end $$;

create function public.set_runner_photo_included(p_user_id uuid,p_runner_id uuid,p_photo_id uuid,p_included boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if not runner_photo_private.lock_owner(p_user_id,p_runner_id) or p_included is null then return false; end if;
  update public.runner_uploaded_photos set included=p_included
    where user_id=p_user_id and runner_id=p_runner_id and id=p_photo_id and state='ready';
  return found;
end $$;

create function public.delete_runner_photo(p_user_id uuid,p_runner_id uuid,p_photo_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if not runner_photo_private.lock_owner(p_user_id,p_runner_id) then return false; end if;
  delete from public.runner_uploaded_photos where user_id=p_user_id and runner_id=p_runner_id and id=p_photo_id;
  return found;
end $$;

create function public.sweep_runner_photo_uploads(p_now timestamptz) returns integer
language plpgsql security invoker set search_path='' as $$
declare runner uuid; changed integer:=0; cutoff timestamptz:=least(p_now,clock_timestamp());
begin
  if p_now is null then return 0; end if;
  for runner in select r.id from public.runners r where r.id in (
    select p.runner_id from public.runner_uploaded_photos p where p.state<>'ready'
      and (coalesce(p.upload_expires_at,p.reservation_expires_at)<=cutoff or p.lease_expires_at<=cutoff)
  ) order by r.id limit 100 for update of r skip locked loop
    changed:=changed+runner_photo_private.recover(runner,cutoff);
  end loop;
  return changed;
end $$;

create function public.claim_runner_photo_cleanup(p_limit integer,p_lease_seconds integer)
returns table(job_id uuid,object_path text,object_kind text,lease_id uuid)
language plpgsql security invoker set search_path='' as $$
declare cutoff timestamptz:=clock_timestamp();
begin
  if p_limit is null or p_limit not between 1 and 100 or p_lease_seconds is null or p_lease_seconds not between 1 and 900 then
    raise exception 'Invalid cleanup claim' using errcode='22023';
  end if;
  return query with due as (
    select j.id from public.runner_photo_cleanup j where j.not_before<=cutoff
      and (j.lease_expires_at is null or j.lease_expires_at<=cutoff)
    order by j.not_before,j.id limit p_limit for update skip locked
  ) update public.runner_photo_cleanup j set lease_id=gen_random_uuid(),
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempts=j.attempts+1
    from due where j.id=due.id returning j.id,j.object_path,j.object_kind,j.lease_id;
end $$;

create function public.ack_runner_photo_cleanup(p_job_id uuid,p_lease_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  delete from public.runner_photo_cleanup where id=p_job_id and lease_id=p_lease_id and lease_expires_at>clock_timestamp();
  return found;
end $$;

create function public.fail_runner_photo_cleanup(p_job_id uuid,p_lease_id uuid,p_error_code text,p_backoff_seconds integer) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  if p_backoff_seconds is null or p_backoff_seconds not between 1 and 86400 or p_error_code is null
    or p_error_code !~ '^[a-z][a-z0-9_]{0,39}$' then return false; end if;
  update public.runner_photo_cleanup set lease_id=null,lease_expires_at=null,last_error_code=p_error_code,
    not_before=clock_timestamp()+make_interval(secs=>p_backoff_seconds)
    where id=p_job_id and lease_id=p_lease_id and lease_expires_at>clock_timestamp();
  return found;
end $$;

revoke all on all functions in schema runner_photo_private from public, anon, authenticated;
grant execute on all functions in schema runner_photo_private to service_role;
revoke all on function public.reserve_runner_photo_upload(uuid,uuid,text,bigint,timestamptz),
  public.activate_runner_photo_upload(uuid,uuid,uuid,timestamptz),
  public.prepare_runner_photo_ready(uuid,uuid,uuid,timestamptz),
  public.finalize_runner_photo_upload(uuid,uuid,uuid,text,uuid,bigint),
  public.set_runner_photo_included(uuid,uuid,uuid,boolean), public.delete_runner_photo(uuid,uuid,uuid),
  public.sweep_runner_photo_uploads(timestamptz), public.claim_runner_photo_cleanup(integer,integer),
  public.ack_runner_photo_cleanup(uuid,uuid), public.fail_runner_photo_cleanup(uuid,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.reserve_runner_photo_upload(uuid,uuid,text,bigint,timestamptz),
  public.activate_runner_photo_upload(uuid,uuid,uuid,timestamptz),
  public.prepare_runner_photo_ready(uuid,uuid,uuid,timestamptz),
  public.finalize_runner_photo_upload(uuid,uuid,uuid,text,uuid,bigint),
  public.set_runner_photo_included(uuid,uuid,uuid,boolean), public.delete_runner_photo(uuid,uuid,uuid),
  public.sweep_runner_photo_uploads(timestamptz), public.claim_runner_photo_cleanup(integer,integer),
  public.ack_runner_photo_cleanup(uuid,uuid), public.fail_runner_photo_cleanup(uuid,uuid,text,integer) to service_role;
