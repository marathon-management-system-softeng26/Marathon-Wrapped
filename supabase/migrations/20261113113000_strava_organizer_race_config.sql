-- Organizers configure the race-matching window per category. The original table pinned
-- distance_tolerance_m to exactly 500, which left nothing for an organizer to manage.
-- Replace that equality check with a bounded positive range and keep every other
-- invariant (Run-only sport types, ordered finite window, all-or-none start location).

alter table public.strava_race_configs
  drop constraint if exists strava_race_configs_distance_tolerance_m_check;

alter table public.strava_race_configs
  add constraint strava_race_config_tolerance
    check (distance_tolerance_m > 0 and distance_tolerance_m <= 5000);

-- Matching reads this table for every candidate import, always by category.
create index if not exists strava_race_configs_category on public.strava_race_configs (category_id);

comment on column public.strava_race_configs.distance_tolerance_m is
  'Organizer-set absolute distance tolerance in metres, 1..5000, compared against the category expected distance.';
comment on column public.strava_race_configs.start_latitude is
  'Optional organizer-only start location. Never returned in a runner-facing payload.';
