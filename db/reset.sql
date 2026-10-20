-- ============================================================
-- Marathon Wrapped — RESET
--
-- ⚠ Drops every table and view. ALL DATA IS WIPED.
-- Only run this on purpose, then run the initial migration SQL and
-- db/seed.sql. db push won't replay an applied migration. Tell the
-- team before running this on the shared
-- Supabase project.
-- ============================================================

drop view  if exists runner_wrapped;
drop table if exists fotoyu_photos   cascade;
drop table if exists strava_metrics  cascade;
drop table if exists chip_splits     cascade;
drop table if exists chip_results    cascade;
drop table if exists runners         cascade;
drop table if exists categories      cascade;
drop table if exists events          cascade;
drop function if exists check_runner_eligibility();
drop function if exists lock_bib_number();
drop function if exists age_on(date, date);
