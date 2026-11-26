import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const bootstrap = `
  create schema auth;
  create table auth.users(id uuid primary key);
  create schema storage;
  create table storage.buckets(id text primary key, name text unique, public boolean,
    file_size_limit bigint, allowed_mime_types text[], versioning_status text default 'DISABLED');
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  grant usage on schema storage to anon,authenticated;
  alter table storage.objects enable row level security;
  grant select,insert,update,delete on storage.objects to anon,authenticated;
  create policy broad_storage_access on storage.objects for all to anon,authenticated using (true) with check (true);
`;
const migrations = "supabase/migrations";
async function setup(exec: (query: string) => Promise<unknown>) {
  await exec(bootstrap);
  for (const file of [
    "20261019155810_initial_schema.sql",
    "20261019184443_core_access_and_rank_contract.sql",
    ...(await readdir(migrations)).filter((f) => f.endsWith("_private_runner_photo_uploads.sql")),
  ]) {
    const source = await readFile(join(migrations, file), "utf8");
    if (file.endsWith("_private_runner_photo_uploads.sql")) {
      await exec("begin");
      try {
        await exec("insert into storage.buckets(id,name,public) values ('runner-photos','runner-photos',true)");
        await assert.rejects(() => exec(source), /Incompatible runner-photos bucket/);
      } finally { await exec("rollback"); }
      await exec("begin");
      try {
        await exec("insert into storage.buckets(id,name,public,versioning_status) values ('runner-photos','runner-photos',false,'ENABLED')");
        await assert.rejects(() => exec(source), /Incompatible runner-photos bucket/);
      } finally { await exec("rollback"); }
    }
    await exec(source);
  }
  const [fixture, checks] = (await readFile("tests/sql/runner-photo-uploads.sql", "utf8")).split("-- Transactional cases");
  await exec(fixture);
  await exec(checks);
}

test("private runner photo migration and lifecycle", { skip: !process.env.RUNNER_PHOTO_PGLITE_MODULE }, async () => {
  const { PGlite } = await import(pathToFileURL(resolve(process.env.RUNNER_PHOTO_PGLITE_MODULE!)).href);
  const db = new PGlite();
  try { await setup((sql) => db.exec(sql)); }
  finally { await db.close(); }
});

// PGlite runs one session. An optional disposable PostgreSQL cluster exercises actual row-lock waits.
test("competing connections cannot reserve a fourth slot", { skip: !process.env.RUNNER_PHOTO_EMBEDDED_PG_MODULE }, async () => {
  const { default: EmbeddedPostgres } = await import(pathToFileURL(resolve(process.env.RUNNER_PHOTO_EMBEDDED_PG_MODULE!)).href);
  const cluster = new EmbeddedPostgres({
    databaseDir: await mkdtemp(join(tmpdir(), "runner-photo-")),
    port: 54987, user: "postgres", password: crypto.randomUUID(), persistent: false,
  });
  await cluster.initialise();
  await cluster.start();
  const a = cluster.getPgClient();
  const b = cluster.getPgClient();
  try {
    await Promise.all([a.connect(), b.connect()]);
    await setup((sql) => a.query(sql));
    const { rows: [owner] } = await a.query("select * from pg_temp.make_photo_owner()");
    const reserve = "select * from public.reserve_runner_photo_upload($1,$2,'image/jpeg',100,now()+interval '3 hours')";
    const args = [owner.u, owner.r];
    const { rows: [first] } = await a.query(reserve, args);
    const photoArgs = [...args, first.photo_id];
    assert.equal((await a.query("select public.activate_runner_photo_upload($1,$2,$3,now()+interval '2h') as ok", photoArgs)).rows[0].ok, true);
    assert.equal((await a.query("select * from public.prepare_runner_photo_ready($1,$2,$3,now()+interval '2m')", photoArgs)).rowCount, 1);
    await a.query(reserve, args);
    await a.query("begin");
    assert.equal((await a.query(reserve, args)).rowCount, 1);
    await b.query("set statement_timeout = '10s'");
    const fourth = b.query(reserve, args);
    try {
      for (let i = 0; ; i++) {
        const result = await a.query("select pg_backend_pid() = any(pg_blocking_pids($1)) as waiting", [b.processID]);
        if (result.rows[0].waiting) break;
        assert.ok(i < 150, "fourth reservation must wait for the uncommitted third slot");
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } finally { await a.query("commit"); }
    assert.equal((await fourth).rowCount, 0);

    const { rows: [other] } = await a.query("select * from pg_temp.make_photo_owner()");
    const pair = [other.u, other.r];
    const count = "select count(*)::int as n from public.runner_uploaded_photos where user_id=$1 and runner_id=$2";
    await a.query(reserve, pair);
    await a.query(reserve, pair);
    await b.query("begin isolation level repeatable read");
    assert.equal((await b.query(count, pair)).rows[0].n, 2);
    assert.equal((await a.query(reserve, pair)).rowCount, 1);
    assert.equal((await b.query(count, pair)).rows[0].n, 2);
    assert.equal((await b.query(reserve, pair)).rowCount, 0, "a stale snapshot cannot allocate a fourth slot");
    await b.query("commit");
    assert.equal((await a.query(count, pair)).rows[0].n, 3);
  } finally {
    await Promise.all([a.end(), b.end()]);
    await cluster.stop();
  }
});
