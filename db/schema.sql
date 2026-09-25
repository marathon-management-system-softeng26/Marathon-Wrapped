-- ============================================================
-- Marathon Wrapped — Database Schema
-- Postgres / Supabase · prototype
-- Demo event: Soekarno Run 2027 · categories: 5K and 10K
--
-- Matches docs/DATA_REQUIREMENTS.md and docs/SRS.md (section 3).
--
-- Run this in the Supabase SQL editor (or psql) to create all
-- tables. Seed data lives in db/seed.sql.
-- To start over, run db/reset.sql first (it wipes all data).
--
-- IDs: runners and every runner table (chip_results, chip_splits,
-- strava_metrics, fotoyu_photos) use uuid ids from gen_random_uuid()
-- (built into Postgres 13+ / Supabase). events and categories keep
-- bigint identity ids.
-- ============================================================

-- ============================================================
-- events — a race event (e.g. Soekarno Run 2027)
-- ============================================================
create table events (
    id          bigint generated always as identity primary key,
    name        text        not null,
    event_date  date        not null,
    location    text,
    created_at  timestamptz not null default now()
);

-- ============================================================
-- categories — a distance category within an event (5K / 10K)
-- Minimum ages follow the Soekarno Run standard: 5K = 13, 10K = 17.
-- ============================================================
create table categories (
    id          bigint generated always as identity primary key,
    event_id    bigint      not null references events(id) on delete cascade,
    name        text        not null check (name in ('5K', '10K')),
    distance_km numeric(5,2) not null,         -- 5 or 10
    min_age     int         not null check (min_age > 0),   -- 13 or 17
    unique (event_id, name)
);

-- ============================================================
-- runners — one registered participant, tied to a category
--
-- Business rules (real-world Soekarno Run registration):
--   * name must match the runner's ID document
--   * name, gender, category and jersey size can't change after
--     registration closes — documented here, not enforced
--     in the prototype
--   * bib_number is unique, non-transferable and can't be
--     changed once assigned — enforced by a trigger below
--   * runners under 17 need parental consent; age must meet the
--     category minimum — enforced by a trigger below
-- ============================================================
create table runners (
    id               uuid primary key default gen_random_uuid(),
    category_id      bigint  not null references categories(id) on delete cascade,
    bib_number       text    unique,           -- assigned after registration; FotoYu photos map to it
    name             text    not null,         -- full legal name, as on the ID
    date_of_birth    date    not null,         -- age is calculated from this
    gender           text    not null check (gender in ('M', 'F')),
    email            text    not null,
    phone            text    not null,         -- contact and emergency
    id_type          text    not null check (id_type in
                         ('KTP', 'SIM', 'Passport', 'KK', 'KITAS', 'Student ID')),
    id_number        text    not null,         -- checked at race pack collection
    jersey_size      text    not null check (jersey_size in ('S', 'M', 'L', 'XL', 'XXL')),
    parental_consent boolean not null default false,  -- required if under 17 on race day
    created_at       timestamptz not null default now()
);

-- Age on race day, from date of birth. Used by the eligibility
-- trigger and the runner_wrapped view.
create or replace function age_on(dob date, on_date date)
returns int language sql immutable as $$
    select extract(year from age(on_date, dob))::int
$$;

-- Rejects a runner who is too young for their category, or under
-- 17 without parental consent.
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

-- A bib can be assigned once (NULL -> value) but never changed.
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

-- ============================================================
-- chip_results — baseline timing from the bib chip (EVERY runner)
-- This is the data the Wrapped is built on.
--
-- Tolerates missing data:
--   * start_status 'dns' (did not start, e.g. > 10 min late) and
--     DNF (finisher = false) have no finish time
--   * a damaged chip can leave the times NULL (a failed read)
-- A finisher must have a complete result.
-- ============================================================
create table chip_results (
    id                uuid primary key default gen_random_uuid(),
    runner_id         uuid    not null unique references runners(id) on delete cascade,
    start_status      text    not null default 'on-time'
                          check (start_status in ('on-time', 'late', 'dns')),
    start_time        timestamptz,              -- gun/chip start
    finish_time       timestamptz,              -- crossing the finish line
    elapsed_seconds   int     check (elapsed_seconds > 0),   -- finish - start
    avg_pace_sec_km   numeric(6,2),             -- average seconds per km
    category_rank     int,                      -- rank within their category
    overall_rank      int,                      -- rank across all runners
    finisher          boolean not null default true,   -- false = DNF / DNS
    check (finish_time > start_time),
    check (not finisher or (start_time is not null and finish_time is not null
                            and elapsed_seconds is not null and avg_pace_sec_km is not null)),
    check (start_status <> 'dns' or not finisher)
);

-- ============================================================
-- chip_splits — per-kilometre splits (drives the "split story")
-- One row per km per runner (5 rows for 5K, 10 rows for 10K).
-- A missing row = a failed chip read at that km mat.
-- Embun uses these for fastest km, negative/positive split, and
-- "where you slowed" insights.
-- ============================================================
create table chip_splits (
    id            uuid primary key default gen_random_uuid(),
    runner_id     uuid   not null references runners(id) on delete cascade,
    km_marker     int    not null check (km_marker > 0),   -- 1, 2, 3, ...
    split_seconds numeric(6,2) not null check (split_seconds > 0),  -- time for THIS km
    unique (runner_id, km_marker)
);

-- ============================================================
-- strava_metrics — OPT-IN enrichment (only runners who connect)
-- Nullable everywhere: a runner may have none of this.
-- ============================================================
create table strava_metrics (
    id                uuid primary key default gen_random_uuid(),
    runner_id         uuid   not null unique references runners(id) on delete cascade,
    avg_heartrate     int,
    max_heartrate     int,
    elevation_gain_m  numeric(7,2),
    calories          int,
    avg_cadence       int,
    connected_at      timestamptz default now()
);

-- ============================================================
-- fotoyu_photos — simulated photo marketplace
-- Photos are manually mapped to a bib_number (no facial
-- recognition in the prototype). A runner can have many photos.
-- ============================================================
create table fotoyu_photos (
    id            uuid primary key default gen_random_uuid(),
    bib_number    text   not null references runners(bib_number) on delete cascade,
    photo_url     text   not null,
    photographer  text,
    captured_km   int,                          -- roughly where on course
    captured_at   timestamptz
);

-- ============================================================
-- Helpful indexes
-- ============================================================
create index idx_runners_category   on runners(category_id);
create index idx_splits_runner      on chip_splits(runner_id);
create index idx_photos_bib         on fotoyu_photos(bib_number);

-- ============================================================
-- Convenience view: everything the Wrapped needs per runner,
-- in one row (Strava columns are NULL when not connected).
--
-- Leaves out private registration data (email, phone, ID
-- number, date of birth) — the Wrapped only needs age.
--
-- Percentile = share of finishers in the same category this
-- runner beat, e.g. 0.72 => "faster than 72% of your category".
-- DNF / DNS runners get a NULL percentile and don't affect anyone
-- else's.
-- ============================================================
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
    -- percentile within category (1.0 = fastest, 0 = slowest, NULL = DNF/DNS)
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
