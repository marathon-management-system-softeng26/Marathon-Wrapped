-- Commit this migration independently, before the repair migration. DROP TRIGGER
-- takes a connection-table DDL lock; do not retain it while locking any job rows.
-- The existing job trigger is sufficient: every legacy commit must transition
-- its leased job, and its rejection rolls back ALL prior effects in that call.
-- The immutable round-3 two-table installation needs a drained-worker rollout;
-- see the Task 8 round-4 report for the bounded Task 15 procedure.
drop trigger strava_projection_guard_connection on public.strava_connections;
