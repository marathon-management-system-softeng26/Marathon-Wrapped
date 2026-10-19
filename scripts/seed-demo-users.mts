import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const ref = process.env.SUPABASE_DEMO_PROJECT_REF;
if (!url || !key || !ref || new URL(url).hostname !== `${ref}.supabase.co`) {
  throw new Error("Explicit SUPABASE_DEMO_PROJECT_REF must match the dedicated test project URL.");
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const saved = existsSync(".env.demo.local") ? readFileSync(".env.demo.local", "utf8") : "";
const password = process.env.DEMO_PASSWORD ?? saved.match(/^DEMO_PASSWORD=(.+)$/m)?.[1] ?? randomBytes(24).toString("base64url");
if (password.length < 16) throw new Error("Use a demo password of at least 16 characters.");
const event = await db.from("events").select("id").eq("name", "Soekarno Run 2027").single();
if (event.error || !event.data) throw new Error("Seed the dedicated demo database first.");
const users = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (users.error) throw new Error("Demo user lookup failed.");
const accounts = [
  { env: "DEMO_RUNNER_A_EMAIL", email: "runner-a@demo.marathon.test", bib: "HERO-5K-001" },
  { env: "DEMO_RUNNER_B_EMAIL", email: "runner-b@demo.marathon.test", bib: "HERO-10K-001" },
  { env: "DEMO_ORGANIZER_EMAIL", email: "organizer@demo.marathon.test", bib: null },
];
for (const account of accounts) {
  const existing = users.data.users.find(user => user.email === account.email);
  const user = existing
    ? await db.auth.admin.updateUserById(existing.id, { password, email_confirm: true })
    : await db.auth.admin.createUser({ email: account.email, password, email_confirm: true });
  if (user.error || !user.data.user) throw new Error(`Could not configure demo account ${account.env}.`);
  if (account.bib) {
    const runner = await db.from("runners").select("id").eq("bib_number", account.bib).single();
    if (runner.error || !runner.data) throw new Error("Required demo runner fixture is absent.");
    const grant = await db.from("runner_access").upsert({ user_id: user.data.user.id, runner_id: runner.data.id });
    if (grant.error) throw new Error("Demo runner mapping failed.");
  } else {
    const grant = await db.from("organizer_access").upsert({ user_id: user.data.user.id, event_id: event.data.id });
    if (grant.error) throw new Error("Demo organizer mapping failed.");
  }
}
writeFileSync(".env.demo.local", ["RUN_DATABASE_TESTS=1", "DEMO_PASSWORD=" + password, ...accounts.map(a => `${a.env}=${a.email}`), "TEST_APP_URL=http://127.0.0.1:3007"].join("\n") + "\n", { mode: 0o600 });
console.log("Three synthetic demo accounts configured. Credentials saved in ignored .env.demo.local; no secrets logged.");
