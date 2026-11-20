begin;

do $$
declare
  edition bigint;
  second_edition bigint;
  five bigint;
  ten bigint;
  second_five bigint;
  runner uuid;
  owner_id uuid := gen_random_uuid();
begin
  insert into public.events(name,event_date)
    values ('Official SQL fixture','2026-02-15') returning id into edition;
  insert into public.events(name,event_date)
    values ('Second SQL fixture','2027-02-15') returning id into second_edition;
  insert into public.categories(event_id,name,distance_km,min_age)
    values (edition,'5K',5,13) returning id into five;
  insert into public.categories(event_id,name,distance_km,min_age)
    values (edition,'10K',10,17) returning id into ten;
  insert into public.categories(event_id,name,distance_km,min_age)
    values (second_edition,'5K',5,13) returning id into second_five;

  insert into public.runners(category_id,bib_number,name,source_kind)
    values (five,'00123','Unofficial staging fixture','scorenow') returning id into runner;
  assert (select event_id=edition and email is null and date_of_birth is null
    from public.runners where id=runner), 'Imported identity gets its category edition without registration PII';

  begin
    insert into public.runners(category_id,bib_number,name,source_kind)
      values (ten,'00123','Duplicate','scorenow');
    raise exception 'Duplicate BIB was accepted across distances';
  exception when unique_violation then null;
  end;
  insert into public.runners(category_id,bib_number,name,source_kind)
    values (second_five,'00123','A different edition','scorenow');

  begin
    insert into public.runners(category_id,event_id,bib_number,name,source_kind)
      values (five,second_edition,'12345','Wrong edition','scorenow');
    raise exception 'Category/edition mismatch was accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.runners(category_id,bib_number,name)
      values (five,'00124','Incomplete legacy fixture');
    raise exception 'Legacy runner was created without registration fields';
  exception when check_violation then null;
  end;
  begin
    insert into public.runners(category_id,bib_number,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
      values (ten,'00125','Underage fixture','2015-02-15','F','fixture@example.invalid','0','Passport','fixture','S');
    raise exception 'Underage legacy runner was created';
  exception when raise_exception then
    if sqlerrm not like '%minimum age%' then raise; end if;
  end;

  insert into auth.users(id) values (owner_id);
  assert public.link_runner_by_bib(owner_id,'00123')='unavailable',
    'Legacy BIB-only link must not claim imported runners';
  assert not exists(select 1 from public.runner_access where runner_id=runner);

  insert into public.fotoyu_photos(runner_id,photo_url)
    values (runner,'/official-test-photo.jpg');
  assert (select bib_number is null from public.fotoyu_photos where runner_id=runner),
    'Official photos must not appear in legacy BIB-only lookups';
  assert not exists(
    select 1 from public.fotoyu_photos p
    left join public.runners r on r.id=p.runner_id
    where p.bib_number is not null and (r.id is null or r.bib_number<>p.bib_number)
  ), 'Existing photo references are backfilled to their original runner UUID';
end $$;

rollback;

