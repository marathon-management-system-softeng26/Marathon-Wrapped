-- Publishing a full ScoreNow catalog is intentionally one transaction. The
-- PostgREST authenticator default is too short for the guarded 9,982-row run,
-- so scope the longer timeout to this service-role-only function.
alter function public.publish_scorenow_import(uuid)
  set statement_timeout = '2min';
