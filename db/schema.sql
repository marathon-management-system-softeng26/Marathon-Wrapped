-- ============================================================
-- Marathon Wrapped — Database Schema
-- Postgres / Supabase · prototype
-- Demo event: Soekarno Run 2027 · categories: 5K and 10K
--
-- Run this in the Supabase SQL editor (or psql) to create all
-- tables. Seed data lives in db/seed.sql.
-- To start over, run db/reset.sql first (it wipes all data).
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
-- ============================================================
create table categories (
    id          bigint generated always as identity primary key,
    event_id    bigint      not null references events(id) on delete cascade,
    name        text        not null,          -- '5K' or '10K'
    distance_km numeric(5,2) not null,         -- 5 or 10
    unique (event_id, name)
);

-- ============================================================
-- runners — one participant, tied to a category, with a bib
-- ============================================================
create table runners (
    id          bigint generated always as identity primary key,
    category_id bigint      not null references categories(id) on delete cascade,
    bib_number  text        not null unique,    -- the key FotoYu photos map to
    name        text        not null,
    gender      text        check (gender in ('M', 'F', 'X')),
    age         int         check (age > 0 and age < 120),
    created_at  timestamptz not null default now()
);

-- ============================================================
-- chip_results — baseline timing from the bib chip (EVERY runner)
-- This is the data the Wrapped is built on.
-- ============================================================
create table chip_results (
    id                bigint generated always as identity primary key,
    runner_id         bigint  not null unique references runners(id) on delete cascade,
    start_time        timestamptz not null,     -- gun/chip start
    finish_time       timestamptz not null,     -- crossing the finish line
    elapsed_seconds   int     not null check (elapsed_seconds > 0),  -- finish - start
    avg_pace_sec_km   numeric(6,2) not null,    -- average seconds per km
    category_rank     int,                      -- rank within their category
    overall_rank      int,                      -- rank across all runners
    finisher          boolean not null default true,   -- false = DNF
    check (finish_time > start_time)
);

-- ============================================================
-- chip_splits — per-kilometre splits (drives the "split story")
-- One row per km per runner (5 rows for 5K, 10 rows for 10K).
-- Embun uses these for fastest km, negative/positive split, and
-- "where you slowed" insights.
-- ============================================================
create table chip_splits (
    id            bigint generated always as identity primary key,
    runner_id     bigint not null references runners(id) on delete cascade,
    km_marker     int    not null check (km_marker > 0),   -- 1, 2, 3, ...
    split_seconds numeric(6,2) not null,        -- time taken for THIS km
    unique (runner_id, km_marker)
);

-- ============================================================
-- strava_metrics — OPT-IN enrichment (only runners who connect)
-- Nullable everywhere: a runner may have none of this.
-- ============================================================
create table strava_metrics (
    id                bigint generated always as identity primary key,
    runner_id         bigint not null unique references runners(id) on delete cascade,
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
    id            bigint generated always as identity primary key,
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
-- Percentile = share of finishers in the same category this
-- runner beat, e.g. 0.72 => "faster than 72% of your category".
-- DNF runners get a NULL percentile and don't affect anyone else's.
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
    r.age,
    c.name          as category,
    c.distance_km,
    cr.elapsed_seconds,
    cr.avg_pace_sec_km,
    cr.category_rank,
    cr.overall_rank,
    cr.finisher,
    -- percentile within category (1.0 = fastest, 0 = slowest, NULL = DNF)
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
join chip_results cr on cr.runner_id = r.id
left join ranked  rk on rk.runner_id = r.id
left join strava_metrics sm on sm.runner_id = r.id;
