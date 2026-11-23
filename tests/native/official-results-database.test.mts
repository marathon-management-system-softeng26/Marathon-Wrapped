import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.env.STRAVA_PGLITE_MODULE;

for (const fixture of ["official-results", "official-results-publication"]) {
  test(fixture, { skip: !modulePath }, async () => {
    const { PGlite } = await import(pathToFileURL(resolve(modulePath!)).href);
    const db = new PGlite();
    try {
      await db.exec(`
        create schema auth;
        create table auth.users (id uuid primary key);
        create role anon;
        create role authenticated;
        create role service_role bypassrls;
      `);

      const migrations = (await readdir("supabase/migrations")).sort();
      for (const migration of migrations) {
        if (migration.endsWith("_official_results_identity.sql")) {
          await db.exec(`
            do $$ declare ed bigint; cat bigint; begin
              insert into public.events(name,event_date) values ('Pre-migration test','2026-05-05') returning id into ed;
              insert into public.categories(event_id,name,distance_km,min_age) values (ed,'5K',5,13) returning id into cat;
              insert into public.runners(id,category_id,bib_number,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
                values ('26362652-c85d-4b0f-adad-edf113aa03ad',cat,'PRE-UPGRADE','Legacy fixture','1997-06-20',
                  'M','fixture@example.invalid','0','Passport','pre-upgrade','S');
              insert into public.fotoyu_photos(bib_number,photo_url) values ('PRE-UPGRADE','/pre-upgrade.jpg');
            end $$;
          `);
        }
        if (migration.includes("_bib_registration_ownership")) break;
        await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
      }
      await db.exec(`
        do $$ begin
          assert exists(select 1 from public.fotoyu_photos
            where bib_number='PRE-UPGRADE' and runner_id='26362652-c85d-4b0f-adad-edf113aa03ad'),
            'The migrated photo must preserve its original runner UUID';
        end $$;
      `);
      const seed = await readFile("db/seed.sql", "utf8");
      await db.exec(seed);
      await db.exec(seed);
      await db.exec(await readFile(`tests/sql/${fixture}.sql`, "utf8"));
    } finally {
      await db.close();
    }
  });
}

