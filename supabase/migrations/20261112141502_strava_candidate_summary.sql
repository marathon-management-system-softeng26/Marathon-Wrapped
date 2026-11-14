-- Keep runner-specific display fields in the existing fenced candidate row.
create function public.strava_sanitize_candidate_summary() returns trigger
language plpgsql security invoker set search_path='' as $$
declare start_date text := new.summary->>'startDate';
  distance_meters jsonb := new.summary->'distanceMeters';
  gps_available jsonb := new.summary->'gpsAvailable';
begin
  if jsonb_typeof(new.summary->'startDate') is distinct from 'string'
    or start_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{3})?Z$'
    or jsonb_typeof(distance_meters) is distinct from 'number' or distance_meters < '0'::jsonb then
    new.summary := '{}'::jsonb;
    return new;
  end if;

  new.summary := jsonb_strip_nulls(jsonb_build_object(
    'startDate',start_date,
    'distanceMeters',distance_meters,
    'gpsAvailable',case
      when new.reason='missing_start_location' then 'false'::jsonb
      when jsonb_typeof(gps_available)='boolean' then gps_available
      when new.reason='race_checks_passed' then 'true'::jsonb
    end
  ));
  return new;
end $$;

revoke all on function public.strava_sanitize_candidate_summary() from public,anon,authenticated;
grant execute on function public.strava_sanitize_candidate_summary() to service_role;

create trigger strava_candidate_summary_privacy before insert or update of summary,reason on public.strava_activity_candidates
  for each row execute function public.strava_sanitize_candidate_summary();

-- Preserve the stored display fields where the older summary included them.
-- This update does not touch classification, selection, or attachment state.
update public.strava_activity_candidates set summary=summary where summary<>'{}'::jsonb;
