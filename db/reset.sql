-- ============================================================
-- Marathon Wrapped — RESET
--
-- ⚠ Drops every table and view. ALL DATA IS WIPED.
-- Only run this on purpose, then re-run db/schema.sql and
-- db/seed.sql. Tell the team before running it on the shared
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
