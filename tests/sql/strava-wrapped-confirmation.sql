do $$
declare f jsonb:=pg_temp.runner_fence_fixture(); u uuid:=(f->>'u')::uuid; g uuid:=(f->>'g')::uuid;
  a uuid:=(f->>'a')::uuid; attachment uuid; result jsonb; organizer uuid:=gen_random_uuid();
begin
  select attachment_id into strict attachment from public.strava_runner_attachments where user_id=u and generation=g and runner_id=a;
  insert into auth.users values(organizer);
  insert into public.organizer_access
    select organizer,c.event_id from public.runners r join public.categories c on c.id=r.category_id where r.id=a;
  insert into public.strava_activities(user_id,generation,activity_id,activity)
    values(u,g,'10',pg_temp.fence_detail('10')->0->'activity' || '{"startDate":"2027-08-17T00:00:00Z","distanceMeters":5000,"gpsAvailable":true}');
  perform public.strava_store_runner_candidates(u,g,a,'[{"activity_id":"10","match_status":"needs_confirmation",
    "reason":"missing_start_location","summary":{"startDate":"2027-08-17T00:00:00Z","distanceMeters":5000,"gpsAvailable":false}}]');
  assert not has_function_privilege('anon','public.strava_wrapped_confirmation(uuid,uuid,uuid,uuid)','execute');
  assert not has_function_privilege('authenticated','public.strava_wrapped_confirmation(uuid,uuid,uuid,uuid)','execute');

  set local role service_role;
  result:=public.strava_wrapped_confirmation(u,a,g,attachment);
  assert result->'candidates'->0->>'activity_id'='10', 'current candidate is visible to its owner';
  assert result->'candidates'->0->'summary'='{"startDate":"2027-08-17T00:00:00Z","distanceMeters":5000,"gpsAvailable":false}'::jsonb,
    'candidate summary is current and allowlisted';
  assert not (result->'candidates'->0->'strava_activities' ? 'averageHeartrate'), 'candidate query excludes health data';
  assert result->'registration'->'runner'->>'id'=a::text, 'registration belongs to same read';
  assert public.strava_wrapped_confirmation(organizer,a,g,attachment) is null, 'event access gives no candidate access';
  assert public.strava_wrapped_confirmation(u,a,g,gen_random_uuid())->'candidates'='[]'::jsonb, 'stale attachment cannot read candidates';
  assert public.strava_wrapped_confirmation(u,a,gen_random_uuid(),attachment)->'candidates'='[]'::jsonb, 'stale generation cannot read candidates';
  reset role;

  update public.strava_activity_candidates set match_status='no_match' where user_id=u and generation=g and runner_id=a;
  result:=public.strava_wrapped_confirmation(u,a,g,attachment);
  assert result->>'state'='no_match' and result->'candidates'='[]'::jsonb, 'reclassified candidate is omitted';
  update public.strava_activity_candidates set match_status='auto_match' where user_id=u and generation=g and runner_id=a;
  perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
  result:=public.strava_wrapped_confirmation(u,a,g,attachment);
  assert result->>'state'='importing' and result->'candidates'='[]'::jsonb, 'selected activity is outside confirmation';
  delete from public.strava_activity_candidates where user_id=u and generation=g and runner_id=a;
  result:=public.strava_wrapped_confirmation(u,a,g,attachment);
  assert result->>'state'='no_match' and result->'candidates'='[]'::jsonb, 'removed candidate is omitted';
  delete from public.runner_access where user_id=u and runner_id=a;
  assert public.strava_wrapped_confirmation(u,a,g,attachment) is null, 'revoked owner cannot read the registration';
end $$;
