begin;
do $$
declare source_id uuid; target_id bigint; denied boolean:=false;
begin
  select id into source_id from public.runners where bib_number='HERO-5K-001';
  select id into target_id from public.categories where name='10K';
  begin update public.runners set category_id=target_id where id=source_id;
  exception when raise_exception then denied:=true; end;
  assert denied, 'Category change must not move incompatible stored results into rankings';
  denied:=false;
  begin update public.chip_results set start_time=null where runner_id=(select id from public.runners where bib_number='EDGE-DNF');
  exception when check_violation then denied:=true; end;
  assert denied, 'DNF requires an observed start';
end $$;
rollback;
select 'category/lifecycle regression assertions passed; mutations rolled back' as result;
