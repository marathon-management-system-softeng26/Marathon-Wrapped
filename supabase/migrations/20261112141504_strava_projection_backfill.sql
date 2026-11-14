-- Upgrade selections made before projection jobs existed. Connection locks
-- precede access/selection/job locks, matching the live worker and detach path.
-- Each statement handles at most 100 selections; each snapshot and job is
-- inserted in the same transaction, and existing ready/building rows win.
create or replace function public.strava_backfill_selected_projections()
returns integer language plpgsql security definer set search_path='' as $$
declare connection record; batch_count integer; total integer:=0;
begin
  for connection in
    select c.user_id,c.generation from public.strava_connections c
      where c.status='active' and exists(select 1 from public.strava_runner_activities s
        where s.user_id=c.user_id and s.generation=c.generation)
      order by c.user_id
  loop
    perform 1 from public.strava_connections c where c.user_id=connection.user_id
      and c.generation=connection.generation and c.status='active' for update;
    if not found then continue; end if;
    loop
      with eligible as materialized (
        select s.user_id,s.generation,s.runner_id,s.activity_id
        from public.strava_runner_activities s
        join public.runner_access access on access.user_id=s.user_id and access.runner_id=s.runner_id
        join public.strava_runner_attachments attachment on attachment.user_id=s.user_id
          and attachment.generation=s.generation and attachment.runner_id=s.runner_id and attachment.status='active'
        join public.strava_connections c on c.user_id=s.user_id and c.generation=s.generation and c.status='active'
        join public.strava_activity_candidates candidate on candidate.user_id=s.user_id and candidate.generation=s.generation
          and candidate.runner_id=s.runner_id and candidate.activity_id=s.activity_id
        join public.strava_activities detail on detail.user_id=s.user_id and detail.generation=s.generation and detail.activity_id=s.activity_id
        where s.user_id=connection.user_id and s.generation=connection.generation
          and public.strava_runner_opted_in(s.user_id,s.generation,s.runner_id)
          and (candidate.match_status='auto_match' or (s.selection_source='manual' and candidate.match_status='needs_confirmation'))
          and jsonb_typeof(detail.activity)='object' and detail.activity->>'id'=s.activity_id
          and detail.activity->>'athleteId'=c.athlete_id and detail.activity->>'sportType'='Run'
          and not exists(select 1 from public.strava_wrapped_snapshots existing
            where existing.user_id=s.user_id and existing.generation=s.generation and existing.runner_id=s.runner_id
              and existing.activity_id=s.activity_id and existing.version=1 and existing.status in ('building','ready'))
        order by s.runner_id limit 100
        for key share of access,s,candidate,detail
      ), cancelled as (
        delete from public.strava_jobs j using eligible s
          where j.user_id=s.user_id and j.generation=s.generation and j.kind='project'
            and j.payload->>'runner_id'=s.runner_id::text and j.status in ('pending','processing')
        returning j.id
      ), snapshots as (
        insert into public.strava_wrapped_snapshots(user_id,generation,runner_id,activity_id,version)
          select s.user_id,s.generation,s.runner_id,s.activity_id,1 from eligible s
            cross join (select count(*) from cancelled) cancelled_count
          on conflict(user_id,generation,runner_id,activity_id,version) do update
            set status='building',payload=null,error_code=null,build_id=gen_random_uuid(),updated_at=now()
            where public.strava_wrapped_snapshots.status='failed'
          returning user_id,generation,runner_id,activity_id,version,build_id
      )
      insert into public.strava_jobs(user_id,generation,kind,dedupe_key,payload)
        select user_id,generation,'project','project:'||build_id::text,
          jsonb_build_object('runner_id',runner_id,'activity_id',activity_id,'version',version,'build_id',build_id)
        from snapshots;
      get diagnostics batch_count=row_count;
      total:=total+batch_count;
      exit when batch_count<100;
    end loop;
  end loop;
  return total;
end $$;

revoke all on function public.strava_backfill_selected_projections() from public,anon,authenticated;
grant execute on function public.strava_backfill_selected_projections() to service_role;

select public.strava_backfill_selected_projections();
