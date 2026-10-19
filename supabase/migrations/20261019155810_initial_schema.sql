-- Marathon Wrapped schema. Seed with db/seed.sql; reset with db/reset.sql.
create table events (
    id          bigint generated always as identity primary key,
    name        text        not null,
    event_date  date        not null,
    location    text,
    created_at  timestamptz not null default now()
);

create table categories (
    id          bigint generated always as identity primary key,
    event_id    bigint      not null references events(id) on delete cascade,
    name        text        not null check (name in ('5K', '10K')),
    distance_km numeric(5,2) not null check (distance_km > 0),
    min_age     int         not null check (min_age > 0),
    unique (event_id, name)
);

create table runners (
    id               uuid primary key default gen_random_uuid(),
    category_id      bigint  not null references categories(id) on delete cascade,
    bib_number       text    unique,
    name             text    not null,
    date_of_birth    date    not null,
    gender           text    not null check (gender in ('M', 'F')),
    email            text    not null,
    phone            text    not null,
    id_type          text    not null check (id_type in
                         ('KTP', 'SIM', 'Passport', 'KK', 'KITAS', 'Student ID')),
    id_number        text    not null,
    jersey_size      text    not null check (jersey_size in ('S', 'M', 'L', 'XL', 'XXL')),
    parental_consent boolean not null default false,
    created_at       timestamptz not null default now()
);

create or replace function age_on(dob date, on_date date)
returns int language sql immutable as $$
    select extract(year from age(on_date, dob))::int
$$;

-- Enforce category age limits and parental consent on race day.
create or replace function check_runner_eligibility()
returns trigger language plpgsql as $$
declare
    race_date date;
    cat_min   int;
    runner_age int;
begin
    select e.event_date, c.min_age into race_date, cat_min
    from categories c join events e on e.id = c.event_id
    where c.id = new.category_id;

    runner_age := age_on(new.date_of_birth, race_date);

    if runner_age < cat_min then
        raise exception 'Runner % is % on race day; the minimum age for this category is %',
            new.name, runner_age, cat_min;
    end if;
    if runner_age < 17 and not new.parental_consent then
        raise exception 'Runner % is under 17 and needs parental consent', new.name;
    end if;
    return new;
end $$;

create trigger runners_eligibility
    before insert or update of category_id, date_of_birth, parental_consent on runners
    for each row execute function check_runner_eligibility();

-- BIBs may be assigned once, but cannot be changed afterward.
create or replace function lock_bib_number()
returns trigger language plpgsql as $$
begin
    if old.bib_number is not null and new.bib_number is distinct from old.bib_number then
        raise exception 'BIB % is non-transferable and cannot be changed', old.bib_number;
    end if;
    return new;
end $$;

create trigger runners_lock_bib
    before update of bib_number on runners
    for each row execute function lock_bib_number();

create table chip_results (
    id                uuid primary key default gen_random_uuid(),
    runner_id         uuid    not null unique references runners(id) on delete cascade,
    start_status      text    not null default 'on-time'
                          check (start_status in ('on-time', 'late', 'dns')),
    start_time        timestamptz,
    finish_time       timestamptz,
    elapsed_seconds   int     check (elapsed_seconds > 0),
    avg_pace_sec_km   numeric(6,2) check (avg_pace_sec_km > 0),
    category_rank     int check (category_rank > 0),
    overall_rank      int check (overall_rank > 0),
    finisher          boolean not null default false,
    check (finish_time > start_time),
    -- Finishers need complete timing; DNS entries cannot finish.
    check (not finisher or (start_time is not null and finish_time is not null
                            and elapsed_seconds is not null and avg_pace_sec_km is not null)),
    check (start_status <> 'dns' or not finisher)
);

create table chip_splits (
    id            uuid primary key default gen_random_uuid(),
    runner_id     uuid   not null references runners(id) on delete cascade,
    km_marker     int    not null check (km_marker > 0),
    split_seconds numeric(6,2) not null check (split_seconds > 0),
    unique (runner_id, km_marker)
);

create table strava_metrics (
    id                uuid primary key default gen_random_uuid(),
    runner_id         uuid   not null unique references runners(id) on delete cascade,
    avg_heartrate     int check (avg_heartrate > 0),
    max_heartrate     int check (max_heartrate > 0),
    elevation_gain_m  numeric(7,2) check (elevation_gain_m >= 0),
    calories          int check (calories >= 0),
    avg_cadence       int check (avg_cadence >= 0),
    connected_at      timestamptz default now()
);

create table fotoyu_photos (
    id            uuid primary key default gen_random_uuid(),
    bib_number    text   not null references runners(bib_number) on delete cascade,
    photo_url     text   not null,
    photographer  text,
    captured_km   int check (captured_km >= 0),
    captured_at   timestamptz
);

create index idx_categories_event on categories(event_id);
create index idx_runners_category   on runners(category_id);
create index idx_photos_bib         on fotoyu_photos(bib_number);

-- Excludes private registration fields; percentile ranges from slowest (0) to fastest (1).
create or replace view runner_wrapped as
with ranked as (
    select
        cr.runner_id,
        percent_rank() over (
            partition by r.category_id
            order by cr.elapsed_seconds desc
        ) as category_percentile
    from chip_results cr
    join runners r on r.id = cr.runner_id
    where cr.finisher
)
select
    r.id            as runner_id,
    r.bib_number,
    r.name,
    r.gender,
    age_on(r.date_of_birth, e.event_date) as age,
    e.name          as event,
    c.name          as category,
    c.distance_km,
    cr.start_status,
    cr.elapsed_seconds,
    cr.avg_pace_sec_km,
    cr.category_rank,
    cr.overall_rank,
    cr.finisher,
    rk.category_percentile,
    sm.avg_heartrate,
    sm.max_heartrate,
    sm.elevation_gain_m,
    sm.calories,
    sm.avg_cadence,
    (sm.runner_id is not null) as has_strava,
    (select count(*) from fotoyu_photos fp
        where fp.bib_number = r.bib_number) as photo_count
from runners r
join categories   c  on c.id = r.category_id
join events       e  on e.id = c.event_id
join chip_results cr on cr.runner_id = r.id
left join ranked  rk on rk.runner_id = r.id
left join strava_metrics sm on sm.runner_id = r.id;

alter table public.events enable row level security;
alter table public.categories enable row level security;
alter table public.runners enable row level security;
alter table public.chip_results enable row level security;
alter table public.chip_splits enable row level security;
alter table public.strava_metrics enable row level security;
alter table public.fotoyu_photos enable row level security;