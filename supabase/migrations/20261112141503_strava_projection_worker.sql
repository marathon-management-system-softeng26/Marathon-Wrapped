-- Projection jobs are authorized by a single attachment incarnation.
create or replace function public.strava_capture_job_attachments() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.strava_connections where user_id=new.user_id for update;
  select coalesce(jsonb_object_agg(a.runner_id::text,a.attachment_id::text),'{}'::jsonb) into new.attachment_fences
    from public.strava_runner_attachments a
    where a.user_id=new.user_id and a.generation=new.generation
      and public.strava_runner_opted_in(a.user_id,a.generation,a.runner_id)
      and (new.kind not in ('backfill','activity') or new.payload->>'runner_id' is null
        or a.runner_id::text=new.payload->>'runner_id');
  return new;
end $$;

create function public.strava_enqueue_projection(p_user uuid,p_generation uuid,p_runner uuid,p_activity text)
returns uuid language plpgsql security definer set search_path='' as $$
declare build uuid;
begin
  build:=public.strava_begin_wrapped_snapshot(p_user,p_generation,p_runner,p_activity,1);
  if build is null then return null; end if;
  insert into public.strava_jobs(user_id,generation,kind,dedupe_key,payload)
    values(p_user,p_generation,'project','project:'||build::text,
      jsonb_build_object('runner_id',p_runner,'activity_id',p_activity,'version',1,'build_id',build));
  return build;
end $$;

-- Selection and enqueue occur in the caller's transaction, including auto-match.
create function public.strava_queue_selected_projection() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' or (new.user_id,new.generation,new.activity_id) is distinct from (old.user_id,old.generation,old.activity_id) then
    perform public.strava_enqueue_projection(new.user_id,new.generation,new.runner_id,new.activity_id);
  end if;
  return new;
end $$;
create trigger strava_queue_selected_projection after insert or update on public.strava_runner_activities
  for each row execute function public.strava_queue_selected_projection();

create function public.strava_confirm_runner_activity_and_project(p_user uuid,p_generation uuid,p_runner uuid,p_activity text)
returns text language sql security definer set search_path='' as $$
  select public.strava_confirm_runner_activity(p_user,p_generation,p_runner,p_activity)
$$;
revoke all on function public.strava_confirm_runner_activity_and_project(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.strava_confirm_runner_activity_and_project(uuid,uuid,uuid,text) to service_role;

create function public.strava_retry_projection_attachments(p_job uuid,p_lease uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.strava_jobs; c public.strava_connections; fences jsonb; runner text;
begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  select * into c from public.strava_connections where user_id=j.user_id for update;
  select * into j from public.strava_jobs where id=p_job for update;
  if j.id is null or j.kind<>'project' or j.status<>'processing' or j.lease_id is distinct from p_lease
    or j.lease_until<=now() or c.status<>'active' or c.generation<>j.generation then return false; end if;
  runner:=j.payload->>'runner_id';
  select coalesce(jsonb_object_agg(a.runner_id::text,a.attachment_id::text),'{}'::jsonb) into fences
    from public.strava_runner_attachments a where a.user_id=j.user_id and a.generation=j.generation
      and public.strava_runner_opted_in(a.user_id,a.generation,a.runner_id);
  if fences->>runner is distinct from j.attachment_fences->>runner or not (fences ? runner) then
    return public.strava_commit_job(p_job,p_lease);
  end if;
  if j.attempts>=8 then
    perform public.strava_finish_wrapped_snapshot(j.user_id,j.generation,runner::uuid,j.payload->>'activity_id',
      (j.payload->>'version')::integer,(j.payload->>'build_id')::uuid,'failed',null,'attachment_changed');
  end if;
  update public.strava_jobs set attachment_fences=fences,status=case when attempts>=8 then 'failed' else 'pending' end,
    available_at=now(),last_error='attachment_changed',lease_id=null,lease_until=null where id=j.id;
  return true;
end $$;

create function public.strava_commit_projection_job(p_job uuid,p_lease uuid,p_payload jsonb,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.strava_jobs; c public.strava_connections; fences jsonb; result text;
begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  select * into c from public.strava_connections where user_id=j.user_id for update;
  select * into j from public.strava_jobs where id=p_job for update;
  if j.id is null or j.kind<>'project' or j.status<>'processing' or j.lease_id is distinct from p_lease
    or j.lease_until<=now() or c.status<>'active' or c.generation<>j.generation then return false; end if;
  select coalesce(jsonb_object_agg(a.runner_id::text,a.attachment_id::text),'{}'::jsonb) into fences
    from public.strava_runner_attachments a where a.user_id=j.user_id and a.generation=j.generation
      and public.strava_runner_opted_in(a.user_id,a.generation,a.runner_id);
  if fences is distinct from j.attachment_fences or not (fences ? (j.payload->>'runner_id')) then
    return public.strava_retry_projection_attachments(p_job,p_lease);
  end if;
  if not exists(select 1 from public.strava_wrapped_snapshots s where s.user_id=j.user_id and s.generation=j.generation
    and s.runner_id::text=j.payload->>'runner_id' and s.activity_id=j.payload->>'activity_id'
    and s.version::text=j.payload->>'version' and s.build_id::text=j.payload->>'build_id' and s.status='building') then
    return public.strava_commit_job(p_job,p_lease);
  end if;
  -- Lock the source rows while comparing the identity and event context used by
  -- the projection. A concurrent registration edit must cause a fresh read.
  if p_error is null then
    perform 1 from public.runners r join public.categories cat on cat.id=r.category_id
      join public.events e on e.id=cat.event_id
      where r.id::text=j.payload->>'runner_id'
        and p_payload->'runner'=jsonb_build_object('id',r.id,'name',r.name,'bibNumber',r.bib_number)
        and p_payload->'event'=jsonb_build_object('name',e.name,'date',e.event_date::text,'category',cat.name)
      for share of r,cat,e;
    if not found then return public.strava_retry_projection_attachments(p_job,p_lease); end if;
  end if;
  result:=public.strava_finish_wrapped_snapshot(j.user_id,j.generation,(j.payload->>'runner_id')::uuid,
    j.payload->>'activity_id',(j.payload->>'version')::integer,(j.payload->>'build_id')::uuid,
    case when p_error is null then 'ready' else 'failed' end,p_payload,p_error);
  return public.strava_commit_job(p_job,p_lease);
end $$;

create function public.strava_commit_projection_refresh_job(
  p_job uuid,p_lease uuid,p_activities jsonb,p_continuation jsonb,p_discoveries jsonb,p_runner_candidates jsonb
) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.strava_jobs; c public.strava_connections; fences jsonb;
begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  select * into c from public.strava_connections where user_id=j.user_id for update;
  select * into j from public.strava_jobs where id=p_job for update;
  if j.id is null or j.kind<>'project' or j.status<>'processing' or j.lease_id is distinct from p_lease
    or j.lease_until<=now() or c.status<>'active' or c.generation<>j.generation then return false; end if;
  if not exists(select 1 from public.strava_wrapped_snapshots s where s.user_id=j.user_id and s.generation=j.generation
    and s.runner_id::text=j.payload->>'runner_id' and s.activity_id=j.payload->>'activity_id'
    and s.version::text=j.payload->>'version' and s.build_id::text=j.payload->>'build_id' and s.status='building') then
    return public.strava_commit_job(p_job,p_lease);
  end if;
  select coalesce(jsonb_object_agg(a.runner_id::text,a.attachment_id::text),'{}'::jsonb) into fences
    from public.strava_runner_attachments a where a.user_id=j.user_id and a.generation=j.generation
      and public.strava_runner_opted_in(a.user_id,a.generation,a.runner_id);
  if fences is distinct from j.attachment_fences then return public.strava_retry_projection_attachments(p_job,p_lease); end if;
  return public.strava_commit_runner_job(p_job,p_lease,p_activities,p_continuation,p_discoveries,p_runner_candidates);
end $$;

create function public.strava_fail_projection_job(p_job uuid,p_lease uuid,p_error text,p_delay integer,p_reauth boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.strava_jobs; c public.strava_connections; incarnation text;
begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  select * into c from public.strava_connections where user_id=j.user_id for update;
  select * into j from public.strava_jobs where id=p_job for update;
  if j.id is null or j.kind<>'project' or j.status<>'processing' or j.lease_id is distinct from p_lease
    or j.lease_until<=now() or c.status<>'active' or c.generation<>j.generation then return false; end if;
  select attachment_id::text into incarnation from public.strava_runner_attachments
    where user_id=j.user_id and generation=j.generation and runner_id::text=j.payload->>'runner_id' and status='active';
  if incarnation is not distinct from j.attachment_fences->>(j.payload->>'runner_id') and incarnation is not null
    and (p_delay is null or j.attempts>=8) then
    perform public.strava_finish_wrapped_snapshot(j.user_id,j.generation,(j.payload->>'runner_id')::uuid,
      j.payload->>'activity_id',(j.payload->>'version')::integer,(j.payload->>'build_id')::uuid,'failed',null,p_error);
  end if;
  return public.strava_commit_job(p_job,p_lease,p_error=>p_error,p_delay=>p_delay,p_reauth=>p_reauth);
end $$;

revoke all on function public.strava_enqueue_projection(uuid,uuid,uuid,text), public.strava_queue_selected_projection(),
  public.strava_commit_projection_job(uuid,uuid,jsonb,text), public.strava_commit_projection_refresh_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb),
  public.strava_fail_projection_job(uuid,uuid,text,integer,boolean), public.strava_retry_projection_attachments(uuid,uuid) from public,anon,authenticated;
grant execute on function public.strava_enqueue_projection(uuid,uuid,uuid,text), public.strava_queue_selected_projection(),
  public.strava_commit_projection_job(uuid,uuid,jsonb,text), public.strava_commit_projection_refresh_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb),
  public.strava_fail_projection_job(uuid,uuid,text,integer,boolean), public.strava_retry_projection_attachments(uuid,uuid) to service_role;

-- An unchanged provider response still refreshes a selected snapshot. Changed
-- details already cascade the selection and enqueue its replacement build.
alter function public.strava_commit_runner_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb) rename to strava_commit_runner_job_before_projection;
create function public.strava_commit_runner_job(
  p_job uuid,p_lease uuid,p_activities jsonb default '[]',p_continuation jsonb default null,
  p_discoveries jsonb default '[]',p_runner_candidates jsonb default '[]'
) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.strava_jobs; prior jsonb; fences jsonb; ok boolean; selected record;
begin
  select * into j from public.strava_jobs where id=p_job;
  if not found then return false; end if;
  perform 1 from public.strava_connections where user_id=j.user_id for update;
  select * into j from public.strava_jobs where id=p_job for update;
  if j.id is null then return false; end if;
  select coalesce(jsonb_object_agg(s.runner_id::text,s.build_id::text),'{}') into prior
    from public.strava_wrapped_snapshots s where s.user_id=j.user_id and s.generation=j.generation and s.version=1;
  select coalesce(jsonb_object_agg(a.runner_id::text,a.attachment_id::text),'{}') into fences
    from public.strava_runner_attachments a where a.user_id=j.user_id and a.generation=j.generation
      and public.strava_runner_opted_in(a.user_id,a.generation,a.runner_id);
  ok:=public.strava_commit_runner_job_before_projection(p_job,p_lease,p_activities,p_continuation,p_discoveries,p_runner_candidates);
  if ok and j.kind='webhook' and fences=j.attachment_fences and exists(select 1 from public.strava_jobs where id=j.id and status='complete') then
    for selected in select s.runner_id,s.activity_id,w.build_id from public.strava_runner_activities s
      left join public.strava_wrapped_snapshots w on w.user_id=s.user_id and w.generation=s.generation and w.runner_id=s.runner_id and w.activity_id=s.activity_id and w.version=1
      where s.user_id=j.user_id and s.generation=j.generation and exists(select 1 from jsonb_array_elements(p_activities) item
        where item->>'id'=s.activity_id and jsonb_typeof(item->'activity')='object') loop
      if selected.build_id::text is not distinct from prior->>selected.runner_id::text then
        perform public.strava_enqueue_projection(j.user_id,j.generation,selected.runner_id,selected.activity_id);
      end if;
    end loop;
  end if;
  return ok;
end $$;
revoke all on function public.strava_commit_runner_job_before_projection(uuid,uuid,jsonb,jsonb,jsonb,jsonb),
  public.strava_commit_runner_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.strava_commit_runner_job_before_projection(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from service_role;
grant execute on function public.strava_commit_runner_job(uuid,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
