-- The full 9,982-row catalog performs identity-preserving runner, result, and
-- checkpoint work in one rollback-safe transaction. Keep the override local
-- to this service-role-only function while allowing the full catalog to land.
alter function public.publish_scorenow_import(uuid)
  set statement_timeout = '10min';
