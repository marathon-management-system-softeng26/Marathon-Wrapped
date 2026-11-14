create function public.strava_scrub_activity_location() returns trigger
language plpgsql security invoker set search_path='' as $$
declare start_location jsonb;
  gps_available boolean := false;
begin
  if jsonb_typeof(new.activity) <> 'object' or new.activity is null then
    return new;
  end if;

  -- Accept the previous worker's normalized shape during deployment.
  if new.activity ? 'startLatLng' then
    start_location := new.activity->'startLatLng';
    if jsonb_typeof(start_location) = 'array' then
      if jsonb_array_length(start_location) = 2
        and jsonb_typeof(start_location->0) = 'number'
        and jsonb_typeof(start_location->1) = 'number' then
        gps_available := abs((start_location->>0)::numeric) <= 90
          and abs((start_location->>1)::numeric) <= 180;
      end if;
    end if;
    new.activity := new.activity || jsonb_build_object('gpsAvailable',gps_available);
  end if;

  new.activity := new.activity - array['startLatLng','start_latlng','endLatLng','end_latlng',
    'coordinate','coordinates','route','map','polyline','summaryPolyline','summary_polyline'];
  return new;
end $$;

revoke all on function public.strava_scrub_activity_location() from public,anon,authenticated;
grant execute on function public.strava_scrub_activity_location() to service_role;

-- The trigger runs before strava_cleanup_activity_selection on activity updates.
create trigger strava_activity_location_privacy before insert or update of activity on public.strava_activities
  for each row execute function public.strava_scrub_activity_location();

-- Scrubbing existing rows must preserve candidates, selections and ready snapshots.
-- Keep the lock and trigger suspension inside one atomic statement.
do $$
begin
  alter table public.strava_activities disable trigger strava_cleanup_activity_selection;
  update public.strava_activities set activity=activity where activity ?| array[
    'startLatLng','start_latlng','endLatLng','end_latlng','coordinate','coordinates','route','map','polyline',
    'summaryPolyline','summary_polyline'];
  alter table public.strava_activities enable trigger strava_cleanup_activity_selection;
end $$;

alter table public.strava_activities add constraint strava_activity_location_privacy check (
  (not (activity ? 'gpsAvailable') or jsonb_typeof(activity->'gpsAvailable') = 'boolean')
  and not jsonb_path_exists(activity,
    'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(start_?latlng|end_?latlng|coordinates?|route|map|polyline|summary_?polyline)$" flag "i")')
);
