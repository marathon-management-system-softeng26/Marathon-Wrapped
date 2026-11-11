-- The native harness runs this prelude before the attachment migration.
begin;
create temporary table attachment_fixture(u uuid, organizer uuid, r uuid, other_runner uuid, g uuid, e bigint);
do $$
declare u uuid := gen_random_uuid(); o uuid := gen_random_uuid(); r uuid := gen_random_uuid();
  r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid(); g uuid := gen_random_uuid(); e bigint; c bigint;
begin
  insert into auth.users values(u),(o);
  insert into public.events(name,event_date) values('Attachment upgrade','2027-08-17') returning id into e;
  insert into public.categories(event_id,name,distance_km,min_age) values(e,'5K',5,17) returning id into c;
  insert into public.runners(id,category_id,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
    values(r,c,'Attached','1990-01-01','M','attachment1@example.invalid','0','Passport','attach1','M'),
      (r2,c,'Not opted in','1990-01-01','M','attachment2@example.invalid','0','Passport','attach2','M'),
      (r3,c,'Inactive connection','1990-01-01','M','attachment3@example.invalid','0','Passport','attach3','M');
  insert into public.runner_access values(u,r),(u,r2),(o,r3);
  insert into public.organizer_access values(o,e);
  insert into public.strava_connections(user_id,generation,status) values(u,g,'active'),(o,g,'reauth_required');
  insert into public.strava_oauth_attempts(state_hash,user_id,generation,status,runner_id,return_path)
    values('attachment-valid',u,g,'connected',r,'/wrapped/'||r),
      ('attachment-duplicate',u,g,'connected',r,'/wrapped/'||r),
      ('attachment-pending',u,g,'pending',r2,'/wrapped/'||r2),
      ('attachment-obsolete',u,gen_random_uuid(),'connected',r2,'/wrapped/'||r2),
      ('attachment-inactive',o,g,'connected',r3,'/wrapped/'||r3);
  insert into public.strava_oauth_attempts(state_hash,user_id,generation,status)
    values('attachment-unscoped',o,gen_random_uuid(),'connected');
  insert into attachment_fixture values(u,o,r,r2,g,e);
end $$;

-- AFTER MIGRATION
do $$
declare f attachment_fixture; old_created timestamptz; rpc text; relation text;
begin
  select * into f from attachment_fixture;
  assert (select count(*) from public.strava_runner_attachments)=1, 'Only valid explicit active scope is upgraded';
  assert public.strava_runner_opted_in(f.u,f.g,f.r);
  assert not public.strava_runner_opted_in(f.u,f.g,f.other_runner);
  update public.strava_connections set status='active' where user_id=f.organizer;
  assert public.strava_attach_runner(f.organizer,f.r)='forbidden', 'Organizer access is not direct ownership';
  assert public.strava_attach_runner(f.u,gen_random_uuid())='forbidden';
  select created_at into old_created from public.strava_runner_attachments where runner_id=f.r;
  assert public.strava_attach_runner(f.u,f.r)='attached';
  assert (select created_at from public.strava_runner_attachments where runner_id=f.r)=old_created;
  assert public.strava_attach_runner(f.u,f.other_runner)='attached';
  assert (select count(*) from public.strava_runner_attachments where user_id=f.u)=2;
  delete from public.strava_oauth_attempts where user_id=f.u;
  assert public.strava_runner_opted_in(f.u,f.g,f.r), 'Durable membership is independent of callback history';
  assert public.strava_detach_runner(f.organizer,f.r)='forbidden';
  assert public.strava_detach_runner(f.u,f.r)='detached';
  assert public.strava_detach_runner(f.u,f.r)='detached', 'Detach is idempotent';
  assert not public.strava_runner_opted_in(f.u,f.g,f.r);
  assert public.strava_runner_opted_in(f.u,f.g,f.other_runner);
  assert exists(select 1 from public.strava_connections where user_id=f.u and generation=f.g and status='active');
  assert public.strava_enqueue(f.u,f.g,'project','project:test','{}'), 'Projection uses existing lease/retry jobs';
  assert public.strava_attach_runner(f.u,f.r)='attached';
  delete from public.runner_access where user_id=f.u and runner_id=f.r;
  assert not exists(select 1 from public.strava_runner_attachments where runner_id=f.r);
  perform public.strava_disconnect(f.u);
  assert not exists(select 1 from public.strava_runner_attachments where user_id=f.u);
  assert public.strava_attach_runner(f.u,f.other_runner)='connection_required';

  foreach rpc in array array['public.strava_attach_runner(uuid,uuid)', 'public.strava_detach_runner(uuid,uuid)',
    'public.strava_begin_wrapped_snapshot(uuid,uuid,uuid,text,integer)',
    'public.strava_finish_wrapped_snapshot(uuid,uuid,uuid,text,integer,uuid,text,jsonb,text)'] loop
    assert not has_function_privilege('anon',rpc,'execute');
    assert not has_function_privilege('authenticated',rpc,'execute');
    assert has_function_privilege('service_role',rpc,'execute');
  end loop;
  foreach relation in array array['strava_runner_attachments','strava_wrapped_snapshots'] loop
    assert (select relrowsecurity from pg_class where oid=('public.'||relation)::regclass);
    assert not has_table_privilege('anon','public.'||relation,'select');
    assert not has_table_privilege('authenticated','public.'||relation,'insert,update,delete,select');
    assert has_table_privilege('service_role','public.'||relation,'select,insert,update,delete');
  end loop;
end $$;
-- Keep the migration, discard only fixture data (the migration ran in this transaction).
delete from auth.users where id in (select u from attachment_fixture union select organizer from attachment_fixture);
delete from public.events where id in (select e from attachment_fixture);
commit;
