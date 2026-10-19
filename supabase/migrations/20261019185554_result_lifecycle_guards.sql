alter table public.chip_results add constraint observed_start_required
  check (start_status = 'dns' or start_time is not null);
alter table public.categories add constraint fixed_demo_distances
  check ((name='5K' and distance_km=5) or (name='10K' and distance_km=10));
alter table public.chip_splits add constraint finite_split_duration
  check (split_seconds <> 'NaN'::numeric);

-- To move categories, the organizer's atomic save must first replace the old
-- result and splits in the same transaction. Never rank stale 5K data in 10K.
create function public.guard_result_category() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.category_id is distinct from old.category_id and (
    exists(select 1 from public.chip_results where runner_id=old.id)
    or exists(select 1 from public.chip_splits where runner_id=old.id)
  ) then
    raise exception 'Replace existing chip results and splits before changing category';
  end if;
  return new;
end $$;
create trigger runners_result_category_guard before update of category_id on public.runners
  for each row execute function public.guard_result_category();
revoke execute on function public.guard_result_category() from public,anon,authenticated;
grant execute on function public.guard_result_category() to service_role;
