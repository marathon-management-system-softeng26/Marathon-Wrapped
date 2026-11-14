import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const email = "organizer@example.test";
const userId = "86cb595b-2a4a-4c55-875c-287f869662a1";
const key = "test-secret-key";
const password = "test-secret-password";
const user = { id: userId, email, email_confirmed_at: "2026-11-12T00:00:00Z" };
const args = ["--email", email, "--event-id", "42"];
const repo = fileURLToPath(new URL("../../", import.meta.url));

type Fixture = {
  pages?: Array<Array<{ id: string; email: string; email_confirmed_at?: string }>>;
  totals?: number[] | null;
  event?: boolean;
  rejectWrite?: boolean;
};

// Run the real SDK against this transport. Every request stays inside the subprocess.
function fakeSupabase(fixture: Fixture, expectedUserId: string, secret: string, expectedKey: string) {
  const mappings = new Set<string>();
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://dedicated.supabase.co" ||
        new Headers(init?.headers).get("apikey") !== expectedKey) {
      throw new Error("Unexpected Supabase target or credentials");
    }
    if (url.pathname === "/auth/v1/admin/users") {
      const page = Number(url.searchParams.get("page"));
      const pageSize = Number(url.searchParams.get("per_page"));
      const pages = fixture.pages ?? [];
      const users = pages[page - 1] ?? [];
      const filler = page < pages.length
        ? Array.from({ length: pageSize - users.length }, (_, index) => ({
            id: `filler-${page}-${index}`,
            email: "someone@example.test",
          }))
        : [];
      const total = fixture.totals?.[page - 1] ??
        (pages.length ? (pages.length - 1) * pageSize + pages.at(-1)!.length : 0);
      const headers = new Headers();
      if (fixture.totals !== null) {
        headers.set("X-Total-Count", String(total));
        headers.set("Link", `</admin/users?page=${Math.ceil(total / pageSize)}&per_page=${pageSize}>; rel="last"`);
      }
      return Response.json({ users: [...users, ...filler] }, { headers });
    }
    if (url.pathname === "/rest/v1/events" && url.searchParams.get("id") === "eq.42") {
      return Response.json(fixture.event === false ? [] : [{ id: 42 }]);
    }
    if (url.pathname === "/rest/v1/organizer_access" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      const conflict = url.searchParams.get("on_conflict");
      if (body.user_id !== expectedUserId || body.event_id !== 42 || conflict !== "user_id,event_id") {
        throw new Error("Expected one event-scoped organizer mapping");
      }
      const mapping = JSON.stringify(body);
      const prefer = new Headers(init.headers).get("Prefer");
      if (fixture.rejectWrite || (mappings.has(mapping) && !prefer?.includes("resolution=ignore-duplicates"))) {
        return Response.json({ message: secret }, { status: 409 });
      }
      mappings.add(mapping);
      return new Response(null, { status: 201 });
    }
    throw new Error("Unexpected Supabase request");
  };
}

function run(
  cliArgs = args,
  fixture: Fixture = { pages: [[user]] },
  env: Partial<NodeJS.ProcessEnv> = {},
  mode: "node" | "npm" | "repeat" = "node",
  cwd = repo,
) {
  const preload = `(${fakeSupabase.toString()})(${JSON.stringify(fixture)}, ${JSON.stringify(userId)}, ${JSON.stringify(password)}, ${JSON.stringify(key)})`;
  const preloadUrl = `data:text/javascript,${encodeURIComponent(preload)}`;
  const entry = mode === "repeat"
    ? ["--input-type=module", "--eval", `
        import { grantOrganizerAccessByEmail } from "./lib/auth/grantOrganizer.ts";
        for (let i = 0; i < 2; i++) {
          console.log(JSON.stringify(await grantOrganizerAccessByEmail(${JSON.stringify(email)}, 42)));
        }
      `]
    : ["scripts/grant-organizer.mts", ...cliArgs];
  const npm = mode === "npm";
  const npmCli = npm && process.platform === "win32"
    ? process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
    : undefined;
  const command = npm && !npmCli ? "npm" : process.execPath;
  const commandArgs = npm
    ? [...(npmCli ? [npmCli] : []), "run", "--silent", "grant:organizer", "--", ...cliArgs]
    : [
        "--conditions=react-server", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--experimental-strip-types",
        "--import", preloadUrl, ...entry,
      ];
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: npm ? `--import=${preloadUrl}` : "",
      SUPABASE_URL: "https://dedicated.supabase.co",
      SUPABASE_DEMO_PROJECT_REF: "dedicated",
      SUPABASE_SECRET_KEY: key,
      DEMO_PASSWORD: password,
      ...env,
    },
    timeout: 10_000,
  });
  assert.ifError(result.error);
  return result;
}

function temporaryCheckout(t: TestContext) {
  const cwd = mkdtempSync(join(tmpdir(), "marathon-grant-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const path of ["package.json", "scripts/grant-organizer.mts", "lib/auth/grantOrganizer.ts", "lib/supabaseServer.ts"]) {
    const target = join(cwd, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(repo, path), target);
  }
  symlinkSync(join(repo, "node_modules"), join(cwd, "node_modules"), "junction");
  return cwd;
}

function assertRejected(result: ReturnType<typeof run>, error: RegExp) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, error);
  assert.ok(!result.stderr.includes(key) && !result.stderr.includes(password));
}

for (const [name, cliArgs] of [
  ["missing flags", []],
  ["missing email", ["--event-id", "42"]],
  ["missing event ID", ["--email", email]],
  ["duplicate email", [...args, "--email", email]],
  ["duplicate event ID", [...args, "--event-id", "42"]],
  ["unknown flag with a secret value", [...args, `--${key}`]],
] as const) {
  test(`rejects ${name}`, () => {
    assertRejected(run([...cliArgs]), /--email.*--event-id/);
  });
}

test("rejects a malformed email without echoing it", () => {
  for (const address of [password, `${email}\n`, "organizer@-example.test", `<${email}`, "a..b@example.test"]) {
    assertRejected(run(["--email", address, "--event-id", "42"]), /valid email/i);
  }
});

test("rejects event IDs that are not positive safe decimal integers", () => {
  for (const eventId of ["0", "-1", "4.2", "4e1", "42\n", "9007199254740992"]) {
    assertRejected(run(["--email", email, "--event-id", eventId]), /positive.*integer/i);
  }
});

test("rejects an absent or mismatched project ref before granting", () => {
  for (const ref of ["", "unrelated"]) {
    assertRejected(run(args, undefined, { SUPABASE_DEMO_PROJECT_REF: ref }), /SUPABASE_DEMO_PROJECT_REF.*match/i);
  }
  assertRejected(
    run(args, undefined, { SUPABASE_URL: "https://dedicated.supabase.co.unrelated.test" }),
    /SUPABASE_DEMO_PROJECT_REF.*match/i,
  );
});

test("rejects a missing email even when an account has a similar address", () => {
  const fixture = { pages: [[{ ...user, email: `other-${email}` }]] };
  assertRejected(run(args, fixture), /no auth user/i);
});

test("rejects duplicate email matches across Auth pages", () => {
  const fixture = { pages: [[user], [{ ...user, id: "duplicate", email: email.toUpperCase() }]] };
  assertRejected(run(args, fixture), /multiple auth users/i);
});

test("rejects an Auth ID repeated across pages even when the row count matches the total", () => {
  const repeated = { id: "repeated-id", email: "someone@example.test" };
  assertRejected(run(args, { pages: [[user, repeated], [repeated]] }), /incomplete auth user scan/i);
});

test("rejects Auth totals that change between pages even when the final total matches coverage", () => {
  assertRejected(run(args, { pages: [[user], [{ id: "other", email: "someone@example.test" }]], totals: [52, 51] }),
    /incomplete auth user scan/i);
});

test("rejects an Auth scan with fewer distinct IDs than the reported total", () => {
  assertRejected(run(args, { pages: [[user]], totals: [2] }), /incomplete auth user scan/i);
});

test("rejects an Auth scan that reports fewer users than it returns", () => {
  assertRejected(run(args, { pages: [[user]], totals: [0] }), /incomplete auth user scan/i);
});

test("rejects an Auth scan without total headers", () => {
  assertRejected(run(args, { pages: [[user]], totals: null }), /incomplete auth user scan/i);
});

test("requires the matching Auth user to have confirmed their email", () => {
  const fixture = { pages: [[{ ...user, email_confirmed_at: undefined, confirmed_at: user.email_confirmed_at }]] };
  assertRejected(run(args, fixture), /confirm.*email/i);
});

test("requires the event to exist before writing a mapping", () => {
  assertRejected(run(args, { pages: [[user]], event: false }), /event.*not found/i);
});

test("the silent npm command resolves a later-page email and prints only IDs without .env.local", (t) => {
  const result = run(args, { pages: [[], [user]] }, {}, "npm", temporaryCheckout(t));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.trim(), `Organizer access granted for user ${userId} and event 42.`);
});

test("the silent npm command loads .env.local and preserves shell overrides", (t) => {
  const cwd = temporaryCheckout(t);
  writeFileSync(join(cwd, ".env.local"), "SUPABASE_DEMO_PROJECT_REF=dedicated\nSUPABASE_SECRET_KEY=file-override\n");
  const result = run(args, undefined, { SUPABASE_DEMO_PROJECT_REF: undefined }, "npm", cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.trim(), `Organizer access granted for user ${userId} and event 42.`);
});

test("the silent npm command reports a real .env.local read failure without exposing details", (t) => {
  const cwd = temporaryCheckout(t);
  mkdirSync(join(cwd, ".env.local"));
  const result = run(args, undefined, {}, "npm", cwd);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), "Could not load .env.local.");
});

test("the silent npm command prints only the fixed error for malformed input", () => {
  const sentinel = "synthetic-malformed-sentinel";
  const result = run(["--email", sentinel, "--event-id", "42"], undefined, {}, "npm");
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), "Enter a valid email address.");
});

test("the silent npm command shows the supported invocation when flags are missing", () => {
  const result = run([], undefined, {}, "npm");
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), "Usage: npm run --silent grant:organizer -- --email <email> --event-id <id>");
});

test("granting the same user and event twice succeeds", () => {
  const result = run(args, undefined, {}, "repeat");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const mapping = JSON.stringify({ userId, eventId: 42 });
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), [mapping, mapping]);
});

test("redacts database error details", () => {
  assertRejected(run(args, { pages: [[user]], rejectWrite: true }), /could not grant organizer access/i);
});
