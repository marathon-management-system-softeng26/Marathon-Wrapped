import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// Optional isolated Postgres runtime; install PGlite outside the repo and point this at its entry module.
test(
  "Strava migration and lifecycle interleavings on PostgreSQL",
  { skip: !process.env.STRAVA_PGLITE_MODULE },
  async () => {
    const { PGlite } = await import(
      pathToFileURL(resolve(process.env.STRAVA_PGLITE_MODULE!)).href
    );
    const db = new PGlite();

    try {
      await db.exec(`
        create schema auth;

        create table auth.users (
          id uuid primary key
        );

        create role anon;
        create role authenticated;
        create role service_role bypassrls;
      `);

      const claimMigrations = (await readdir("supabase/migrations"))
        .filter((file) => file.endsWith("_strava_first_runner_claims.sql"))
        .sort().map((file) => `supabase/migrations/${file}`);
      for (const file of [
        "supabase/migrations/20261019155810_initial_schema.sql",
        "supabase/migrations/20261019184443_core_access_and_rank_contract.sql",
        "supabase/migrations/20261019185554_result_lifecycle_guards.sql",
        "supabase/migrations/20261019190232_organizer_management.sql",
        "supabase/migrations/20261020020029_organizer_optional_aggregate.sql",
        "supabase/migrations/20261026175630_strava_integration.sql",
        "supabase/migrations/20261028192351_strava_lifecycle.sql",
        "supabase/migrations/20261101000100_strava_race_matching.sql",
        "supabase/migrations/20261101000200_strava_worker_matching.sql",
        "supabase/migrations/20261102074802_strava_atomic_confirmation.sql",
        "tests/sql/strava-scope-upgrade.sql",
        "supabase/migrations/20261102192931_strava_runner_scope_privacy.sql",
        ...claimMigrations,
        "tests/sql/strava-lifecycle.sql",
        "tests/sql/strava-processing.sql",
        "tests/sql/strava-confirmation.sql",
        "tests/sql/strava-scope.sql",
        "tests/sql/runner-claims.sql",
      ]) {
        await db.exec(await readFile(file, "utf8"));
        if (file.endsWith("strava_runner_scope_privacy.sql")) await db.exec("select pg_temp.verify_strava_scope_upgrade()");
      }

      // Exercise the old contract before upgrading, then verify the replacement
      // against persisted scopes, including inactive and obsolete attempts.
      const attachmentFixture = (await readFile("tests/sql/strava-attachments.sql", "utf8"))
        .split("-- AFTER MIGRATION");
      await db.exec(attachmentFixture[0]);
      for (const file of (await readdir("supabase/migrations"))
        .filter((file) => /_(strava_runner_attachments_and_snapshots|strava_snapshot_write_fencing)\.sql$/.test(file)).sort()) {
        await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
      }
      await db.exec(attachmentFixture[1]);
      await db.exec(await readFile("tests/sql/strava-wrapped-snapshots.sql", "utf8"));
      // Existing lifecycle and OAuth callers must remain operational after rollout.
      for (const file of ["strava-lifecycle", "strava-processing", "strava-confirmation", "strava-scope"]) {
        await db.exec(await readFile(`tests/sql/${file}.sql`, "utf8"));
      }
      for (const file of (await readdir("supabase/migrations"))
        .filter((file) => file.endsWith("_strava_multi_runner_lifecycle.sql")).sort()) {
        await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
      }
      await db.exec(await readFile("tests/sql/strava-multi-runner.sql", "utf8"));
      for (const file of ["strava-lifecycle", "strava-processing", "strava-confirmation", "strava-wrapped-snapshots"]) {
        await db.exec(await readFile(`tests/sql/${file}.sql`, "utf8"));
      }
      for (const file of (await readdir("supabase/migrations"))
        .filter((file) => file.endsWith("_strava_attachment_incarnation_fences.sql")).sort()) {
        await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
      }
      const [fenceSetup, ...fenceCases] = (await readFile("tests/sql/strava-multi-runner-fences.sql", "utf8")).split("-- CASE ");
      await db.exec(fenceSetup);
      const fenceErrors: string[] = [];
      for (const scenario of fenceCases) {
        const newline = scenario.indexOf("\n");
        await db.exec("begin");
        try { await db.exec(scenario.slice(newline)); }
        catch (error) { fenceErrors.push(`${scenario.slice(0, newline)}: ${(error as Error).message}`); }
        finally { await db.exec("rollback"); }
      }
      assert.deepEqual(fenceErrors, [], "Attachment regression cases");

      for (const file of (await readdir("supabase/migrations"))
        .filter((file) => file.endsWith("_strava_webhook_retry_and_selection.sql")).sort()) {
        await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
      }
      const retryErrors: string[] = [];
      for (const scenario of (await readFile("tests/sql/strava-webhook-retry.sql", "utf8")).split("-- CASE ").slice(1)) {
        const newline = scenario.indexOf("\n");
        await db.exec("begin");
        try { await db.exec(scenario.slice(newline)); }
        catch (error) { retryErrors.push(`${scenario.slice(0, newline)}: ${(error as Error).message}`); }
        finally { await db.exec("rollback"); }
      }
      assert.deepEqual(retryErrors, [], "Webhook retry regression cases");

      // Hold a token exchange across a committed detach, then deliver its grant
      // through the actual completion RPC. This is a pending async operation,
      // not merely a terminal callback replay or an expired attempt fixture.
      await db.exec("begin");
      try {
        const fixture = (await db.query("select pg_temp.runner_fence_fixture() as fixture")).rows[0].fixture;
        await db.query("delete from public.strava_connections where user_id=$1", [fixture.u]);
        await db.query("select public.strava_begin_runner_oauth($1,$2,'async-exchange',$3)", [fixture.u, fixture.a, `/wrapped/${fixture.a}`]);
        await db.query("select public.strava_claim_runner_oauth($1,'async-exchange')", [fixture.u]);
        let deliver!: (value: string) => void;
        const providerResponse = new Promise<string>((resolve) => { deliver = resolve; });
        const callback = (async () => {
          const tokens = await providerResponse;
          return db.query("select public.strava_finish_oauth($1,'async-exchange',$2::jsonb) as outcome", [fixture.u, tokens]);
        })();
        await db.query("select public.strava_detach_runner($1,$2)", [fixture.u, fixture.a]);
        deliver(JSON.stringify({ athlete_id: "900", access_token: "encrypted", refresh_token: "encrypted", expires_at: "2030-01-01T00:00:00Z", scopes: ["activity:read_all"] }));
        assert.equal((await callback).rows[0].outcome, "cancelled");
        const cleanup = await db.query("select c.status, c.refresh_token, exists(select 1 from public.strava_jobs j where j.user_id=c.user_id and kind='revoke') as revoke from public.strava_connections c where user_id=$1", [fixture.u]);
        assert.deepEqual(cleanup.rows, [{ status: "disconnecting", refresh_token: "encrypted", revoke: true }]);
      } finally { await db.exec("rollback"); }

      const [legacyLocation, verifyLocation] = (await readFile("tests/sql/strava-activity-location-privacy.sql", "utf8"))
        .split("-- AFTER MIGRATION");
      await db.exec(legacyLocation);
      for (const file of (await readdir("supabase/migrations"))
        .filter((file) => file.endsWith("_strava_activity_location_privacy.sql")).sort()) {
        await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
      }
      await db.exec(verifyLocation);

      const [legacySummary, verifySummary] = (await readFile("tests/sql/strava-candidate-summary.sql", "utf8"))
        .split("-- AFTER MIGRATION");
      await db.exec(legacySummary);
      for (const file of (await readdir("supabase/migrations"))
        .filter((file) => file.endsWith("_strava_candidate_summary.sql")).sort()) {
        await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
      }
      await db.exec(verifySummary);

      for (const file of ["strava-lifecycle", "strava-processing", "strava-confirmation", "strava-wrapped-snapshots", "strava-multi-runner"]) {
        await db.exec(await readFile(`tests/sql/${file}.sql`, "utf8"));
      }

      for (const file of (await readdir("supabase/migrations"))
        .filter((file) => file.endsWith("_strava_projection_worker.sql")).sort()) {
        await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
      }
      for (const scenario of (await readFile("tests/sql/strava-projection-worker.sql", "utf8")).split("-- CASE ").slice(1)) {
        await db.exec("begin");
        try { await db.exec(scenario.slice(scenario.indexOf("\n"))); }
        finally { await db.exec("rollback"); }
      }

      const [backfillSetup, backfillVerify] = (await readFile("tests/sql/strava-projection-backfill.sql", "utf8")).split("-- AFTER MIGRATION");
      await db.exec("begin");
      try {
        await db.exec(backfillSetup);
        const backfillMigrations = (await readdir("supabase/migrations"))
          .filter((file) => file.endsWith("_strava_projection_backfill.sql")).sort();
        for (const file of backfillMigrations) {
          await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
        }
        await db.exec(backfillVerify);
        for (const file of backfillMigrations) {
          await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
        }
        await db.exec(backfillVerify);
      } finally { await db.exec("rollback"); }

      for (const file of (await readdir("supabase/migrations"))
        .filter((file) => file.endsWith("_strava_projection_backfill.sql") || /_strava_projection_review_(fixes|round[234]|round4_barrier)\.sql$/.test(file)).sort()) {
        if (file.endsWith("_strava_projection_review_round3.sql")) {
          // Legacy terminal commits win after round-2 repair, before the job barrier.
          await db.exec(`
            create temporary table projection_cutover (outcome text primary key, f jsonb, build_id uuid);
            do $$
            declare outcome text; f jsonb; u uuid; g uuid; a uuid; j jsonb; athlete text; reauth boolean; build uuid;
            begin
              foreach outcome in array array['complete','ineligible','reauth','retained_reauth','rate_limited'] loop
                f:=pg_temp.runner_fence_fixture();
                u:=(f->>'u')::uuid; g:=(f->>'g')::uuid; a:=(f->>'a')::uuid;
                athlete:=(901+(select count(*) from projection_cutover))::text;
                update public.strava_connections set athlete_id=athlete where user_id=u;
                insert into public.strava_activities(user_id,generation,activity_id,activity) values(u,g,'10',
                  jsonb_set(pg_temp.fence_detail('10')->0->'activity','{athleteId}',to_jsonb(athlete)));
                perform public.strava_store_runner_candidates(u,g,a,pg_temp.fence_batch(a,'10')->'candidates');
                perform public.strava_confirm_runner_activity_and_project(u,g,a,'10');
                j:=public.strava_claim_projection_aware_job();
                assert j->>'user_id'=u::text, 'cutover fixture must claim its own job';
                build:=(j->'payload'->>'build_id')::uuid;
                reauth:=outcome in ('reauth','retained_reauth');
                -- The normal reauth trigger cascades the build away. Disable it only
                -- for one fixture to model a retained legacy row requiring settlement.
                if outcome='retained_reauth' then
                  alter table public.strava_connections disable trigger strava_cleanup_runner_generation;
                end if;
                if outcome='rate_limited' then
                  update public.strava_jobs set attempts=8 where id=(j->>'id')::uuid;
                end if;
                assert public.strava_commit_job_internal((j->>'id')::uuid,(j->>'lease_id')::uuid,
                  p_error=>case when reauth then 'reauth_required' when outcome='rate_limited' then outcome end,
                  p_reauth=>reauth,p_delay=>case when outcome='rate_limited' then 60 end);
                if outcome='retained_reauth' then
                  alter table public.strava_connections enable trigger strava_cleanup_runner_generation;
                end if;
                if outcome='ineligible' then
                  update public.strava_activity_candidates set match_status='no_match' where user_id=u;
                end if;
                assert exists(select 1 from public.strava_jobs where id=(j->>'id')::uuid and status in ('complete','failed'));
                assert (outcome<>'reauth')=exists(select 1 from public.strava_wrapped_snapshots where runner_id=a and status='building');
                insert into projection_cutover values(outcome,f,build);
              end loop;
            end $$;
          `);
        }
        await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
      }
      const projectionReviewErrors: string[] = [];
      for (const outcome of ["complete", "rate_limited", "reauth", "retained_reauth", "ineligible"]) {
        try {
          await db.exec(`do $$ declare fixture record; runner uuid; owner uuid; begin
            select * into strict fixture from projection_cutover where outcome='${outcome}';
            runner:=(fixture.f->>'a')::uuid; owner:=(fixture.f->>'u')::uuid;
            if fixture.outcome in ('complete','rate_limited') then
              assert exists(select 1 from public.strava_wrapped_snapshots w join public.strava_jobs j
                on j.payload->>'build_id'=w.build_id::text and j.status='pending'
                where w.runner_id=runner and w.status='building' and w.build_id<>fixture.build_id),
                'post-barrier repair must recover eligible terminal legacy builds: '||fixture.outcome;
            else
              assert not exists(select 1 from public.strava_wrapped_snapshots where runner_id=runner and status='building'),
                'post-barrier repair must settle stranded legacy builds: '||fixture.outcome;
            end if;
            if fixture.outcome in ('reauth','retained_reauth') then
              assert exists(select 1 from public.strava_connections where user_id=owner and status='reauth_required');
            elsif fixture.outcome='rate_limited' then
              assert exists(select 1 from public.strava_connections where user_id=owner and rate_limited_until>now());
            end if;
          end $$;`);
        } catch (error) { projectionReviewErrors.push((error as Error).message); }
      }
      await db.exec("delete from auth.users where id in (select (f->>'u')::uuid from projection_cutover)");
      const reviewSql = (await Promise.all(["strava-projection-review", "strava-projection-round4"].map((name) => readFile(`tests/sql/${name}.sql`, "utf8")))).join("\n");
      for (const scenario of reviewSql.split("-- CASE ").slice(1)) {
        const newline = scenario.indexOf("\n");
        await db.exec("begin");
        try { await db.exec(scenario.slice(newline)); }
        catch (error) { projectionReviewErrors.push(`${scenario.slice(0, newline)}: ${(error as Error).message}`); }
        finally { await db.exec("rollback"); }
      }
      assert.deepEqual(projectionReviewErrors, [], "Projection review regression cases");

      for (const file of (await readdir("supabase/migrations"))
        .filter((file) => file.endsWith("_strava_wrapped_confirmation_read.sql"))) {
        await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
      }
      await db.exec("begin");
      try { await db.exec(await readFile("tests/sql/strava-wrapped-confirmation.sql", "utf8")); }
      finally { await db.exec("rollback"); }

      // PGlite queues these calls on one connection: this tests competing requests
      // and the ownership constraint, not independent PostgreSQL lock scheduling.
      await db.exec(`
        insert into auth.users values ('10000000-0000-0000-0000-000000000001'),
          ('10000000-0000-0000-0000-000000000002');
        insert into public.events(id,name,event_date) overriding system value values (991,'Claim race','2027-08-17');
        insert into public.categories(id,event_id,name,distance_km,min_age) overriding system value values (991,991,'5K',5,17);
        insert into public.runners(id,category_id,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
          values ('20000000-0000-0000-0000-000000000001',991,'Race runner','1990-01-01','M','race@example.invalid','0','Passport','race','M');
        insert into public.organizer_access values ('10000000-0000-0000-0000-000000000001',991);
        set role service_role;
        select public.create_runner_claim('10000000-0000-0000-0000-000000000001',991,
          '20000000-0000-0000-0000-000000000001',repeat('9',64),now()+interval '7 days');
      `);
      const competitors = await Promise.all([
        db.query("select public.consume_runner_claim('10000000-0000-0000-0000-000000000001',repeat('9',64)) as result"),
        db.query("select public.consume_runner_claim('10000000-0000-0000-0000-000000000002',repeat('9',64)) as result"),
      ]);
      assert.deepEqual(competitors.map((result) => result.rows[0].result).sort(), ["claimed", "invalid_claim"]);
      const owners = await db.query("select count(*)::int as count from public.runner_access where runner_id='20000000-0000-0000-0000-000000000001'");
      assert.equal(owners.rows[0].count, 1);
      await db.exec("reset role");

      // Re-run the migration with legacy duplicate owners. It must abort before
      // modifying data and give operators an actionable diagnostic.
      await db.exec(`
        drop index public.runner_access_one_owner;
        insert into public.runner_access values ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001');
      `);
      await assert.rejects(db.exec(await readFile(claimMigrations[0], "utf8")), /duplicate direct owners/i);
      const preserved = await db.query("select count(*)::int as count from public.runner_access where runner_id='20000000-0000-0000-0000-000000000001'");
      assert.equal(preserved.rows[0].count, 2);
    } finally {
      await db.close();
    }
  },
);
