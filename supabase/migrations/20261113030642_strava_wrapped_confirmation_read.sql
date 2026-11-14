-- The candidate list and its authorization and lifecycle checks share one MVCC snapshot.
create function public.strava_wrapped_confirmation(p_user uuid, p_runner uuid, p_generation uuid, p_attachment uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  with context as (
    select jsonb_build_object(
      'runner',jsonb_build_object('id',r.id,'name',r.name,'bibNumber',r.bib_number),
      'event',jsonb_build_object('name',e.name,'date',e.event_date,'category',cat.name)
    ) as registration, c.athlete_id,
    case
      when c.status='reauth_required' or c.credentials_uncertain then 'reauth_required'
      when c.status is distinct from 'active' then 'setup_required'
      when c.athlete_id is null or not coalesce('activity:read_all'=any(c.granted_scopes),false) then 'reauth_required'
      when c.generation is distinct from p_generation then 'importing'
      when a.attachment_id is null then 'setup_required'
      when a.attachment_id is distinct from p_attachment or s.activity_id is not null then 'importing'
      else coalesce((
        select case when j.status='failed' then 'failed' else 'importing' end
        from public.strava_jobs j
        where j.user_id=p_user and j.generation=p_generation
          and j.attachment_fences->>p_runner::text=p_attachment::text
          and j.kind in ('backfill','activity','webhook') and j.status in ('pending','processing','failed')
        order by (j.status='failed')
        limit 1
      ),'no_match')
    end as state
    from public.runner_access ra
    join public.runners r on r.id=ra.runner_id
    join public.categories cat on cat.id=r.category_id
    join public.events e on e.id=cat.event_id
    left join public.strava_connections c on c.user_id=ra.user_id
    left join public.strava_runner_attachments a on a.user_id=ra.user_id and a.generation=c.generation
      and a.runner_id=ra.runner_id and a.status='active'
    left join public.strava_runner_activities s on s.user_id=ra.user_id and s.generation=c.generation and s.runner_id=ra.runner_id
    where ra.user_id=p_user and ra.runner_id=p_runner
  )
  select jsonb_build_object('state',ctx.state,'registration',ctx.registration,'athlete_id',ctx.athlete_id,
    'candidates',coalesce((
      select jsonb_agg(jsonb_build_object(
        'activity_id',cand.activity_id,'match_status',cand.match_status,'reason',cand.reason,
        'summary',jsonb_build_object('startDate',cand.summary->'startDate','distanceMeters',cand.summary->'distanceMeters',
          'gpsAvailable',cand.summary->'gpsAvailable'),
        'strava_activities',jsonb_build_object('id',detail.activity->>'id','athleteId',detail.activity->>'athleteId',
          'sportType',detail.activity->>'sportType','startDate',detail.activity->>'startDate',
          'distanceMeters',detail.activity->'distanceMeters','gpsAvailable',detail.activity->'gpsAvailable')
      ) order by cand.activity_id)
      from public.strava_activity_candidates cand
      join public.strava_activities detail on detail.user_id=cand.user_id and detail.generation=cand.generation
        and detail.activity_id=cand.activity_id
      where ctx.state='no_match' and cand.user_id=p_user and cand.generation=p_generation and cand.runner_id=p_runner
        and cand.match_status in ('auto_match','needs_confirmation')
        and detail.activity->>'id'=cand.activity_id and detail.activity->>'athleteId'=ctx.athlete_id
        and detail.activity->>'sportType'='Run'
    ),'[]'::jsonb))
  from context ctx;
$$;

revoke all on function public.strava_wrapped_confirmation(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.strava_wrapped_confirmation(uuid,uuid,uuid,uuid) to service_role;
