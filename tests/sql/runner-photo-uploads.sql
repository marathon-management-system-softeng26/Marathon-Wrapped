do $$
declare rel regclass; role_name text; func regprocedure; priv text;
begin
  assert exists (select from storage.buckets where id='runner-photos' and not public and file_size_limit=5242880
    and allowed_mime_types=array['image/jpeg','image/png','image/webp']), 'private runner-photos bucket is missing or misconfigured';
  foreach rel in array array['public.runner_uploaded_photos'::regclass,'public.runner_photo_cleanup'::regclass] loop
    assert (select relrowsecurity from pg_class where oid=rel);
    assert not exists (select from pg_policy where polrelid=rel);
    foreach role_name in array array['anon','authenticated'] loop
      foreach priv in array array['select','insert','update','delete','truncate','references','trigger'] loop
        assert not has_table_privilege(role_name,rel,priv);
      end loop;
    end loop;
  end loop;
  for func in select oid from pg_proc where pronamespace='public'::regnamespace and proname like '%runner_photo%' loop
    assert not has_function_privilege('anon',func,'execute') and not has_function_privilege('authenticated',func,'execute');
    assert has_function_privilege('service_role',func,'execute');
    assert (select not prosecdef and 'search_path=""'=any(proconfig) from pg_proc where oid=func);
  end loop;
  assert exists (select from pg_indexes where tablename='runner_uploaded_photos' and indexdef like '%(user_id, runner_id, state, created_at)%');
  assert exists (select from pg_indexes where tablename='runner_photo_cleanup' and indexdef like '%(not_before%');
end $$;

create function pg_temp.make_photo_owner() returns table(u uuid,r uuid,org uuid) language plpgsql as $$
declare e bigint; c bigint;
begin
  u:=gen_random_uuid(); org:=gen_random_uuid();
  insert into auth.users values (u),(org);
  insert into public.events(name,event_date) values ('Photo fixture','2026-01-01') returning id into e;
  insert into public.categories(event_id,name,distance_km,min_age) values(e,'5K',5,12) returning id into c;
  insert into public.runners(category_id,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
    values(c,'Runner','1990-01-01','F','fixture@example.test','0','Passport','fixture','M') returning id into r;
  insert into public.runner_access values(u,r);
  insert into public.organizer_access values(org,e);
  return next;
end $$;

-- Transactional cases
begin;
create temp table photo_fixture as select * from pg_temp.make_photo_owner();
grant select on photo_fixture to service_role;
set local role service_role;
do $$
declare f record; a record; b record; c record; first_writer record; writer record; job record;
  deadline timestamptz:=now()+interval '3h'; token_end timestamptz:=now()+interval '2h';
begin
  select * into strict f from photo_fixture;
  assert not exists (select from public.reserve_runner_photo_upload(f.org,f.r,'image/jpeg',5,deadline));
  select * into strict a from public.reserve_runner_photo_upload(f.u,f.r,'image/jpeg',5,deadline);
  select * into strict b from public.reserve_runner_photo_upload(f.u,f.r,'image/png',5242880,deadline);
  select * into strict c from public.reserve_runner_photo_upload(f.u,f.r,'image/webp',1,deadline);
  begin
    update public.runner_uploaded_photos set staging_object_path=a.staging_object_path where id=b.photo_id;
    raise exception 'duplicate staging path accepted';
  exception when unique_violation then null; end;
  begin
    update public.runner_uploaded_photos set input_size_bytes=5242881 where id=a.photo_id;
    raise exception 'oversize declaration accepted';
  exception when check_violation then null; end;
  begin
    update public.runner_uploaded_photos set input_mime_type='image/gif' where id=a.photo_id;
    raise exception 'invalid declaration type accepted';
  exception when check_violation then null; end;
  begin
    update public.runner_uploaded_photos set state='ready' where id=a.photo_id;
    raise exception 'ready row without metadata accepted';
  exception when check_violation then null; end;
  assert not public.activate_runner_photo_upload(f.org,f.r,a.photo_id,token_end);
  assert not exists (select from public.prepare_runner_photo_ready(f.u,f.r,a.photo_id,now()+interval '2m'));
  assert public.activate_runner_photo_upload(f.u,f.r,a.photo_id,token_end);
  assert not public.activate_runner_photo_upload(f.u,f.r,a.photo_id,token_end+interval '1m');
  assert not exists (select from public.prepare_runner_photo_ready(f.org,f.r,a.photo_id,now()+interval '2m'));
  select * into strict first_writer from public.prepare_runner_photo_ready(f.u,f.r,a.photo_id,now()+interval '2m');
  assert not exists (select from public.prepare_runner_photo_ready(f.u,f.r,a.photo_id,now()+interval '2m'));
  assert not exists (select from public.reserve_runner_photo_upload(f.u,f.r,'image/png',5,deadline));
  assert not public.set_runner_photo_included(f.u,f.r,a.photo_id,false);
  assert public.sweep_runner_photo_uploads(now())=0;
  update public.runner_uploaded_photos set lease_expires_at=now()-interval '1s' where id=a.photo_id;
  assert public.sweep_runner_photo_uploads(now())=1;
  assert (select state='pending' and upload_expires_at=token_end and ready_object_path is null from public.runner_uploaded_photos where id=a.photo_id);
  assert exists (select from public.runner_photo_cleanup where object_path=first_writer.ready_object_path and object_kind='provisional_ready' and not_before>now());
  select * into strict writer from public.prepare_runner_photo_ready(f.u,f.r,a.photo_id,now()+interval '2m');
  assert writer.ready_object_path<>first_writer.ready_object_path and writer.lease_id<>first_writer.lease_id;
  assert not public.finalize_runner_photo_upload(f.u,f.r,a.photo_id,writer.ready_object_path,first_writer.lease_id,11);
  assert not public.finalize_runner_photo_upload(f.u,f.r,a.photo_id,first_writer.ready_object_path,writer.lease_id,11);
  assert not public.finalize_runner_photo_upload(f.org,f.r,a.photo_id,writer.ready_object_path,writer.lease_id,11);
  assert public.finalize_runner_photo_upload(f.u,f.r,a.photo_id,writer.ready_object_path,writer.lease_id,11);
  assert public.finalize_runner_photo_upload(f.u,f.r,a.photo_id,writer.ready_object_path,writer.lease_id,11);
  assert exists (select from public.runner_uploaded_photos where id=a.photo_id and included and ready_mime_type='image/webp' and ready_size_bytes=11);
  assert exists (select from public.runner_photo_cleanup where object_path=a.staging_object_path and object_kind='staging' and not_before>token_end);
  assert not public.set_runner_photo_included(f.org,f.r,a.photo_id,false);
  assert public.set_runner_photo_included(f.u,f.r,a.photo_id,false);
  assert (select not included from public.runner_uploaded_photos where id=a.photo_id);
  assert not public.delete_runner_photo(f.org,f.r,a.photo_id);
  assert public.delete_runner_photo(f.u,f.r,a.photo_id);
  assert not public.delete_runner_photo(f.u,f.r,a.photo_id);
  select * into strict job from public.claim_runner_photo_cleanup(5,60);
  assert job.object_path=writer.ready_object_path and job.object_kind='ready';
  assert not exists (select from public.claim_runner_photo_cleanup(5,60));
  assert not public.ack_runner_photo_cleanup(job.job_id,gen_random_uuid());
  assert public.fail_runner_photo_cleanup(job.job_id,job.lease_id,'storage_unavailable',30);
  assert exists (select from public.runner_photo_cleanup where id=job.job_id and attempts=1 and not_before>=now()+interval '30s' and last_error_code='storage_unavailable');
  update public.runner_photo_cleanup set not_before=now() where id=job.job_id;
  select * into strict job from public.claim_runner_photo_cleanup(5,60);
  update public.runner_photo_cleanup set lease_expires_at=now()-interval '1s' where id=job.job_id;
  assert not public.ack_runner_photo_cleanup(job.job_id,job.lease_id);
  select * into strict job from public.claim_runner_photo_cleanup(5,60);
  assert public.ack_runner_photo_cleanup(job.job_id,job.lease_id);
  assert public.delete_runner_photo(f.u,f.r,b.photo_id);
  assert exists (select from public.runner_photo_cleanup where object_path=b.staging_object_path and not_before>deadline);
  -- Refill both deleted slots. Expiring the last row must admit exactly one replacement.
  perform public.reserve_runner_photo_upload(f.u,f.r,'image/png',5,deadline);
  perform public.reserve_runner_photo_upload(f.u,f.r,'image/png',5,deadline);
  assert not exists (select from public.reserve_runner_photo_upload(f.u,f.r,'image/png',5,deadline));
  update public.runner_uploaded_photos set reservation_expires_at=now()-interval '1s' where id=c.photo_id;
  assert not public.activate_runner_photo_upload(f.u,f.r,c.photo_id,token_end);
  assert public.sweep_runner_photo_uploads(now())=1;
  select * into strict a from public.reserve_runner_photo_upload(f.u,f.r,'image/jpeg',5,deadline);
  assert not exists (select from public.reserve_runner_photo_upload(f.u,f.r,'image/png',5,deadline));
  delete from public.runner_uploaded_photos where user_id=f.u and runner_id=f.r and id<>a.photo_id;
  assert public.activate_runner_photo_upload(f.u,f.r,a.photo_id,token_end);
  select * into strict writer from public.prepare_runner_photo_ready(f.u,f.r,a.photo_id,now()+interval '2m');
  update public.runner_uploaded_photos set upload_expires_at=now()-interval '1s' where id=a.photo_id;
  assert not public.finalize_runner_photo_upload(f.u,f.r,a.photo_id,writer.ready_object_path,writer.lease_id,11);
  assert public.sweep_runner_photo_uploads(now())=1;
  assert exists (select from public.runner_photo_cleanup where object_path=writer.ready_object_path and not_before>writer.lease_expires_at);
  select * into strict a from public.reserve_runner_photo_upload(f.u,f.r,'image/jpeg',5,deadline);
  assert public.activate_runner_photo_upload(f.u,f.r,a.photo_id,token_end);
  select * into strict writer from public.prepare_runner_photo_ready(f.u,f.r,a.photo_id,now()+interval '2m');
  select * into strict b from public.reserve_runner_photo_upload(f.u,f.r,'image/png',15,deadline);
  assert public.activate_runner_photo_upload(f.u,f.r,b.photo_id,token_end);
  update public.runner_uploaded_photos set upload_expires_at=now()-interval '1s' where id=b.photo_id;
  perform public.reserve_runner_photo_upload(f.u,f.r,'image/jpeg',5,deadline);
  assert not exists (select from public.runner_uploaded_photos where id=b.photo_id);
  assert exists (select from public.runner_photo_cleanup where object_path=b.staging_object_path and not_before>now());
  delete from public.runner_access where user_id=f.u and runner_id=f.r;
  assert not exists (select from public.runner_uploaded_photos where id=a.photo_id);
  assert exists (select from public.runner_photo_cleanup where object_path=writer.ready_object_path and not_before>writer.lease_expires_at);
  assert exists (select from public.runner_photo_cleanup where object_path=a.staging_object_path and not_before>token_end);
end $$;
rollback;
