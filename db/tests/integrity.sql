-- Transactional mutation tests; no QA runner or changed result survives rollback.
begin;
do $$
declare
  fixture record;
  source_runner public.runners%rowtype;
  runner_key uuid;
  accepted boolean;
  seconds_total int;
begin
  select * into strict source_runner from public.runners where bib_number='HERO-5K-001';
  for fixture in select * from (values ('QA-CORE-RANK-1',1500),('QA-CORE-RANK-2',1500),('QA-CORE-RANK-3',1800)) data(bib,seconds)
  loop
    insert into public.runners(category_id,bib_number,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
    values(source_runner.category_id,fixture.bib,'Temporary SQL assertion','1995-01-01','M','qa@example.test','000','Student ID',fixture.bib,'M') returning id into runner_key;
    seconds_total := fixture.seconds;
    insert into public.chip_results(runner_id,start_time,finish_time,elapsed_seconds,avg_pace_sec_km,finisher)
      values(runner_key,'2027-08-17 06:00:00+07','2027-08-17 06:00:00+07'::timestamptz+make_interval(secs=>seconds_total),seconds_total,seconds_total::numeric/5,true);
  end loop;
  assert (select category_rank from public.runner_wrapped where bib_number='QA-CORE-RANK-1')=1, 'First tie rank';
  assert (select category_rank from public.runner_wrapped where bib_number='QA-CORE-RANK-2')=1, 'Second tie rank';
  assert (select category_rank from public.runner_wrapped where bib_number='HERO-5K-001')=3, 'Competition rank skips ties';
  assert (select overall_rank from public.runner_wrapped where bib_number='HERO-10K-002')=1, '5K results must not change 10K overall rank';
  update public.chip_results set finish_time=start_time+interval '1400 seconds',elapsed_seconds=1400,avg_pace_sec_km=280
    where runner_id=(select id from public.runners where bib_number='QA-CORE-RANK-3');
  assert (select category_rank from public.runner_wrapped where bib_number='HERO-5K-001')=4, 'Changing a peer recalculates ranks';

  accepted:=false;
  begin update public.runners set bib_number='QA-TRANSFER' where id=source_runner.id; accepted:=true;
  exception when raise_exception then null; end;
  assert not accepted, 'Assigned BIB must remain immutable';

  accepted:=false;
  begin insert into public.chip_results(runner_id) values(source_runner.id); accepted:=true;
  exception when unique_violation then null; end;
  assert not accepted, 'Duplicate results must be rejected';

  accepted:=false;
  begin insert into public.chip_splits(runner_id,km_marker,split_seconds) values(source_runner.id,6,300); accepted:=true;
  exception when raise_exception then null; end;
  assert not accepted, 'Out-of-range kilometer must be rejected';

  accepted:=false;
  begin update public.chip_results set avg_pace_sec_km=999 where runner_id=source_runner.id; accepted:=true;
  exception when raise_exception then null; end;
  assert not accepted, 'Contradictory finish pace must be rejected';

  accepted:=false;
  begin update public.chip_results set elapsed_seconds=1 where runner_id=(select id from public.runners where bib_number='EDGE-DNF'); accepted:=true;
  exception when check_violation then null; end;
  assert not accepted, 'DNF must not retain finish statistics';

  accepted:=false;
  begin insert into public.runners(category_id,bib_number,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
    values(source_runner.category_id,'QA-UNDERAGE','Minor without consent','2012-01-01','F','qa@example.test','000','Student ID','QA-MINOR','M'); accepted:=true;
  exception when raise_exception then null; end;
  assert not accepted, 'Under-17 runner requires parental consent';
end $$;
rollback;
select 'rank, lifecycle, immutability and eligibility assertions passed; mutations rolled back' as result;
