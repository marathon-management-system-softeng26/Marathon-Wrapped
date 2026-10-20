WITH new_event AS (
  INSERT INTO public.events (name, event_date, location)
  VALUES ('Sample 5K Run', DATE '2026-11-15', 'Central Park')
  RETURNING id
), new_category AS (
  INSERT INTO public.categories (event_id, name, distance_km, min_age)
  SELECT id, '5K', 5.0, 18
  FROM new_event
  RETURNING id
), new_runner AS (
  INSERT INTO public.runners (category_id, bib_number, name, date_of_birth, gender, email, phone, id_type, id_number, jersey_size, parental_consent)
  SELECT id, 'SAMPLE-001', 'Sample Runner', DATE '1995-04-12', 'M', 'sample@example.com', '0000000000', 'Student ID', 'SAMPLE-ID-001', 'M', false
  FROM new_category
  RETURNING id, bib_number
), ne
w_result AS (
  INSERT INTO public.chip_results (runner_id, start_time, finish_time, elapsed_seconds, avg_pace_sec_km, category_rank, overall_rank, start_status, finisher)
  SELECT id, TIMESTAMPTZ '2026-11-15 08:00:00+00', TIMESTAMPTZ '2026-11-15 08:27:30+00', 1650, 330, 1, 1, 'on-time', true
  FROM new_runner
  RETURNING id
), 
new_split AS (
  INSERT INTO public.chip_splits (runner_id, km_marker, split_seconds)
  SELECT id, 1, 330
  FROM new_runner
  RETURNING id
), 
new_split AS (
  INSERT INTO public.chip_splits (runner_id, km_marker, split_seconds)
  SELECT id, 2, 330
  FROM new_runner
  RETURNING id
), 
new_split AS (
  INSERT INTO public.chip_splits (runner_id, km_marker, split_seconds)
  SELECT id, 3, 330
  FROM new_runner
  RETURNING id
), 
new_split AS (
  INSERT INTO public.chip_splits (runner_id, km_marker, split_seconds)
  SELECT id, 4, 330
  FROM new_runner
  RETURNING id
), 
new_split AS (
  INSERT INTO public.chip_splits (runner_id, km_marker, split_seconds)
  SELECT id, 5, 330
  FROM new_runner
  RETURNING id
), 
new_metrics AS (
  INSERT INTO public.strava_metrics (runner_id, avg_heartrate, max_heartrate, elevation_gain_m, calories, avg_cadence, connected_at)
  SELECT id, 150, 178, 32.5, 410, 84, TIMESTAMPTZ '2026-11-15 09:00:00+00'
  FROM new_runner
  RETURNING id
), new_photo AS (
  INSERT INTO public.fotoyu_photos (bib_number, photo_url, photographer, captured_km, captured_at)
  SELECT bib_number, 'https://example.com/sample-runner.jpg', 'Sample Photographer', 3, TIMESTAMPTZ '2026-11-15 08:16:30+00'
  FROM new_runner
  RETURNING id
)
SELECT
  (SELECT count(*) FROM new_event) AS events_inserted,
  (SELECT count(*) FROM new_category) AS categories_inserted,
  (SELECT count(*) FROM new_runner) AS runners_inserted,
  (SELECT count(*) FROM new_result) AS chip_results_inserted,
  (SELECT count(*) FROM new_split) AS chip_splits_inserted,
  (SELECT count(*) FROM new_metrics) AS strava_metrics_inserted,
  (SELECT count(*) FROM new_photo) AS fotoyu_photos_inserted;