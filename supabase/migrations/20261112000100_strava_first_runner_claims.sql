-- Bind revocation to the runner in the organizer URL as well as the event.
drop function public.revoke_runner_claim(uuid,bigint,uuid);

create function public.revoke_runner_claim(p_organizer uuid, p_event bigint, p_runner uuid, p_claim uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.organizer_access a
    where a.user_id = p_organizer and a.event_id = p_event for share;
  if not found then return false; end if;
  update public.runner_claims set revoked_at = clock_timestamp()
    where id = p_claim and event_id = p_event and runner_id = p_runner
      and revoked_at is null and claimed_at is null;
  return found;
end $$;

revoke execute on function public.revoke_runner_claim(uuid,bigint,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_runner_claim(uuid,bigint,uuid,uuid)
  to service_role;