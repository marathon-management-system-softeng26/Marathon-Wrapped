-- Snapshot mutations must pass through the generation, selection, and build fences.
revoke insert, update, delete on public.strava_wrapped_snapshots from service_role;
grant select on public.strava_wrapped_snapshots to service_role;

-- The selection cleanup trigger must still delete obsolete snapshots after the
-- service role loses direct table DML privileges.
create or replace function public.strava_cleanup_wrapped_selection() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (new.user_id,new.generation,new.activity_id) is distinct from (old.user_id,old.generation,old.activity_id) then
    delete from public.strava_wrapped_snapshots where user_id=old.user_id and generation=old.generation and runner_id=old.runner_id;
  end if;
  return new;
end $$;
revoke all on function public.strava_cleanup_wrapped_selection() from public,anon,authenticated;
grant execute on function public.strava_cleanup_wrapped_selection() to service_role;

create or replace function public.strava_begin_wrapped_snapshot(
  p_user uuid,p_generation uuid,p_runner uuid,p_activity text,p_version integer
) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  perform 1 from public.strava_connections where user_id=p_user and generation=p_generation and status='active' for update;
  if not found then return null; end if;
  perform 1 from public.runner_access where user_id=p_user and runner_id=p_runner for key share;
  if not found or not public.strava_runner_opted_in(p_user,p_generation,p_runner) then return null; end if;
  perform 1 from public.strava_runner_activities where user_id=p_user and generation=p_generation
    and runner_id=p_runner and activity_id=p_activity for key share;
  if not found then return null; end if;
  insert into public.strava_wrapped_snapshots(user_id,generation,runner_id,activity_id,version)
    values(p_user,p_generation,p_runner,p_activity,p_version)
    on conflict(user_id,generation,runner_id,activity_id,version) do update
      set status='building',payload=null,error_code=null,build_id=gen_random_uuid(),updated_at=now()
    returning build_id into result;
  return result;
end $$;

create or replace function public.strava_finish_wrapped_snapshot(
  p_user uuid,p_generation uuid,p_runner uuid,p_activity text,p_version integer,p_build uuid,
  p_status text,p_payload jsonb default null,p_error text default null
) returns text language plpgsql security definer set search_path='' as $$
begin
  if p_status is null or p_status not in ('ready','failed') then
    raise exception 'Invalid snapshot transition' using errcode='22023';
  end if;
  perform 1 from public.strava_connections where user_id=p_user and generation=p_generation and status='active' for update;
  if not found then return 'obsolete'; end if;
  perform 1 from public.runner_access where user_id=p_user and runner_id=p_runner for key share;
  if not found or not public.strava_runner_opted_in(p_user,p_generation,p_runner) then return 'obsolete'; end if;
  perform 1 from public.strava_runner_activities where user_id=p_user and generation=p_generation
    and runner_id=p_runner and activity_id=p_activity for key share;
  if not found then return 'obsolete'; end if;
  update public.strava_wrapped_snapshots set status=p_status,payload=p_payload,error_code=p_error,updated_at=now()
    where user_id=p_user and generation=p_generation and runner_id=p_runner and activity_id=p_activity
      and version=p_version and build_id=p_build and status='building';
  if not found then return 'obsolete'; end if;
  return p_status;
end $$;
revoke all on function public.strava_begin_wrapped_snapshot(uuid,uuid,uuid,text,integer),
  public.strava_finish_wrapped_snapshot(uuid,uuid,uuid,text,integer,uuid,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.strava_begin_wrapped_snapshot(uuid,uuid,uuid,text,integer),
  public.strava_finish_wrapped_snapshot(uuid,uuid,uuid,text,integer,uuid,text,jsonb,text)
  to service_role;
