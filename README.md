# Slotwell

## Development

```sh
npm ci --ignore-scripts
# Review any required dependency lifecycle scripts before narrowly approving them.
# Do not enable all install scripts or run an unrestricted rebuild.
npm run dev
```

- Frontend: http://localhost:3000
- API health: http://localhost:3000/api/health → `{"status":"ok"}`

## Local PostgreSQL (M1 scaffold and lazy application entry)

Requires Docker/Compose and Node >=22.13 for the pinned Hono CLI. The database
factory, application entry, schema, migrations and smoke use PostgreSQL. This is
local scaffold infrastructure, not a cloud deployment or persisted booking flow.
Installed SQLite packages are retained but have no runtime factory/callers.
`pg`/`@types/pg` are pinned to 8.23.1; official `@hono/cli` is the explicitly
approved 1.0.0-rc.8, not a floating `next` tag. Install with scripts disabled;
esbuild has a postinstall, so if its binary is unavailable, stop for scoped review
rather than enabling scripts globally.

### Credentials and start

Inspect/preserve any existing ignored `.env.local` first. Never overwrite it or
unrelated secrets. For a fresh checkout the following **refuses an existing file**
and generates independent hex passwords without printing them:

```sh
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const [admin, app, test] = Array.from({ length: 3 }, () => randomBytes(32).toString('hex'));
writeFileSync('.env.local', [
  `POSTGRES_PASSWORD=${admin}`,
  `APP_DB_PASSWORD=${app}`,
  `TEST_DB_PASSWORD=${test}`,
  `DATABASE_URL=postgresql://slotwell_app:${app}@127.0.0.1:55432/slotwell_dev`,
  `TEST_DATABASE_URL=postgresql://slotwell_test:${test}@127.0.0.1:55432/slotwell_test`,
  '',
].join('\n'), { flag: 'wx', mode: 0o600 });
JS

docker compose --env-file .env.local config --quiet
docker compose --env-file .env.local up -d --wait postgres
```

The project is `slotwell-m1`, bound only to `127.0.0.1:55432`; leave unrelated
PostgreSQL on 5432 alone. Do not print expanded Compose config, inspect container
environments, or put passwords/URLs in command arguments. The three passwords
are required (no reusable defaults). Local Docker access can read container
secrets: this is a trusted-workstation setup, not production hardening.

The digest-pinned official PostgreSQL 18.6 Bookworm image mounts the named volume
`slotwell-m1-pg18-data` at **`/var/lib/postgresql`** (18's default PGDATA is
`/var/lib/postgresql/18/docker`, not the older image's data mount). Health checks
prove readiness only, not password authentication or successful SQL writes.

### One-time isolated role/database bootstrap

On a freshly initialized project volume, run this once. The admin uses local
container psql; subsequent verification uses TCP/SCRAM authentication. Preflight
refuses existing target roles/databases. If anything fails, stop and inspect:
**do not retry destructively, adopt existing objects, or drop/recreate them**.
Database creation cannot be wrapped in a transaction; partial state needs review.
Do not run competing bootstrap sessions.

```sh
docker compose --env-file .env.local exec -T postgres \
  psql -X -v ON_ERROR_STOP=1 -U slotwell_admin -d postgres <<'SQL'
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('slotwell_app', 'slotwell_test'))
     OR EXISTS (SELECT FROM pg_database WHERE datname IN ('slotwell_dev', 'slotwell_test')) THEN
    RAISE EXCEPTION 'Target roles/databases already exist; stop for inspection';
  END IF;
END $$;
\getenv app_password APP_DB_PASSWORD
\getenv test_password TEST_DB_PASSWORD
SET password_encryption = 'scram-sha-256';
CREATE ROLE slotwell_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE slotwell_test LOGIN PASSWORD :'test_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE slotwell_dev OWNER slotwell_app;
CREATE DATABASE slotwell_test OWNER slotwell_test;
REVOKE ALL ON DATABASE slotwell_dev, slotwell_test FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres, template1 FROM PUBLIC;
GRANT CONNECT ON DATABASE slotwell_dev TO slotwell_app;
GRANT CONNECT ON DATABASE slotwell_test TO slotwell_test;
COMMENT ON DATABASE slotwell_dev IS 'slotwell-m1:development:slotwell_app';
COMMENT ON DATABASE slotwell_test IS 'slotwell-m1:test:slotwell_test';
SQL
```

These independent LOGIN roles have no memberships or cluster-management powers.
Each owns only its matching database and cannot connect to the other or the
maintenance databases. They are **local database-owner/migration credentials**,
not production least-privilege runtime roles. Never use admin credentials in the
application/tests. The pool factory, lazy application entry and URL guards are
available below. The disposable harness owns only fresh private schemas inside
`slotwell_test`, never shared development/test objects or the volume.

### PostgreSQL factory and application lifecycle

`src/db/open.ts` is a framework-independent Node script/test factory. Importing it
loads no environment file and creates no pool/connection. The frontend still
stores bookings only in page memory; no catalog/appointment persistence is claimed.

`src/db/index.ts` is server-only and exports `getDatabase()` and
`closeDatabase()`, not an eager `db`. Import does not read environment, validate a
URL, create a pool or connect. First `getDatabase()` requires a validated
`DATABASE_URL` for **slotwell_app / slotwell_dev only**; the test role is refused.
It returns one cached process-local Drizzle handle; changing env later does not
replace it. There is no automatic migration, connection, global/HMR cache or
signal handler. The lifecycle owner must explicitly await `closeDatabase()`.
Concurrent/repeated closes share one promise, including shutdown failures.
Closing before creation reads no env and creates no pool, but is still terminal:
`getDatabase()` refuses with `Database is closed` during/after any shutdown,
even if no handle was ever created. A closed entry cannot resurrect a pool.

- `validateDatabaseUrl(value: string | undefined)` returns the accepted URL
  unchanged or throws `Invalid database URL` without raw input/cause. Require
  `postgres:`/`postgresql:`, explicit nonempty username/password, `127.0.0.1:55432`,
  and matching `slotwell_app`/`slotwell_dev` or `slotwell_test`/`slotwell_test`.
  Implicit libpq defaults, admin/remote/arbitrary targets, malformed escapes,
  whitespace, query parameters (including search_path/options) and fragments are
  rejected. This local-only policy is not a production remote/TLS policy.
- `openPostgresDatabase(url)` validates before creating an independent lazy
  `pg.Pool` and Drizzle handle: `{ pool, db, close }`. Each call owns a different
  pool, max 5 connections, 5000ms connect timeout and 10000ms idle timeout. No SQL
  runs until a caller uses the handle. Scripts/tests must not import the
  application-only `src/db/index.ts` entry.
- The caller releases every checked-out client and **awaits `close()`** in finally.
  Close caches one shutdown promise, including rejection: repeated/concurrent
  calls do not repeat `pool.end()`. Failure rejects with `Database shutdown failed`
  without raw cause. Closed handles must not be reused; closing one pool does not
  close any other pool. Pool idle errors report only `database_pool_idle_error`,
  never the error object or connection configuration.
- Drizzle uses `logger: false` and `paramsInErrors: false`. **Internal query errors
  are not sanitized:** SQL text and raw driver causes/SQLSTATE may remain for
  later transaction-conflict/rollback mapping. Query failures still reject.
  Never log or serialize these errors or their cause chains, SQL, parameters,
  credentials or connection config. API/script boundaries must map internal
  failures to allowlisted outward errors without raw causes; the smoke uses
  a fixed `PostgreSQL smoke failed` diagnostic. This is not permission for SQL/PII telemetry exposure.
- URL validation authorizes neither schema selection nor cleanup/reset. #59 may
  separately validate session/schema isolation **inside `slotwell_test`**, without
  URL query/search_path overrides or admitting extra databases/admin roles.

Units require no PostgreSQL, credentials, environment loading or network:

```sh
npx --no-install tsx --test src/db/open.test.ts
```

### PostgreSQL migrations and smoke

After provisioning (reuse existing roles/volume; do not bootstrap again):

```sh
npm run db:generate
# Inspect any generated migration.sql and snapshot.json before applying.
npm run db:migrate
npm run db:smoke
```

The installed generator writes `drizzle/<tag>/migration.sql` and `snapshot.json`
for a changed schema, with no generated journal; no-change generation writes no
new pair. The committed scaffold migration creates only `scaffold_checks` with
an integer generated-always identity primary key and non-null text label.
Migrate applies pending migrations; repeating it with no changes is safe. No
migration runs on application import or getter use.

Smoke uses two independently owned app-role pools: insert a fictional row,
read the committed row through the second pool, then delete only its returned
primary key. Cleanup is attempted even after read/assertion failure; both pools
are awaited even if deletion or either close fails. Success prints
`PostgreSQL write/read/delete passed`; failures print only
`PostgreSQL smoke failed` and exit nonzero. This is not a reset/integration harness.

Config and smoke explicitly load **root `.env.local`**, quietly and without
overriding inherited process env (even an inherited empty/invalid value wins).
They require app-role `DATABASE_URL`; no implicit `.env` or `DB_FILE_NAME`
fallback exists. The factory/entry never load env files themselves. Next uses
its built-in server env loader: inherited env takes precedence over env files;
keep database variables private, never `NEXT_PUBLIC_`.
The test harness explicitly loads `TEST_DATABASE_URL`, never falling back to
`DATABASE_URL`. Next's test-mode env loader skips `.env.local`; units load no
credential file. Schema/session isolation is internal to the harness, never
selected with URL query/search_path overrides.

Build requires no database connection. Without stopping shared PostgreSQL,
verify using an inherited deliberately unusable credential:

```sh
DATABASE_URL=postgresql://slotwell_app:unusable@127.0.0.1:55432/slotwell_dev npm run build
```

### Disposable PostgreSQL integration tests

```sh
npm run test:db
# Database-independent, no credential-file reads/network:
env -u DATABASE_URL -u TEST_DATABASE_URL npm run test:unit
```

Node-only repository tests import `withTestDatabase` from `@/db/testing`, not the
application singleton. Each call runs committed migrations before the callback:

```ts
await withTestDatabase({ now: 1800000000000 }, async ({ db, independentDb, migrate, now }) => {
  // Two distinct checked-out pg sessions, each bound to this run's private schema.
  // now is one fixed epoch-ms value (defaults to Date.now() captured once).
  await migrate(); // Same installed migrator, idempotent; private ledger too.
  // Return a value if desired; never retain either handle beyond this callback.
});
```

Invocation quietly loads root `.env.local` without overriding inherited values;
import does not read env or create connections. Only explicit `TEST_DATABASE_URL`
is accepted: **slotwell_test / slotwell_test at 127.0.0.1:55432**, with the unchanged
local URL validator (no options/query/fragment overrides). Both held sessions
verify current database/user, matching database owner and pre-existing database
comment `slotwell-m1:test:slotwell_test` before schema mutation. No admin,
development, remote, provisioning or fallback authority is granted.

The harness atomically creates a random `slotwell_test_<UUID hex>` schema and
cryptographic ownership comment, retaining its exact name/OID/owner/nonce.
Collisions are refused, never adopted. Session search paths contain only that
private schema, not public; Drizzle wraps held clients, never an unrestricted
pool. Logging is off and query parameters are excluded from Drizzle errors.
The installed migrator uses this same schema for its ledger and the fixed
committed `drizzle/` folder; no caller-selected schema/path/reset is accepted.
The entire SQL set is inspected before execution, without rewriting SQL. The
bounded supported forms are unqualified `CREATE TABLE` with ordinary constraints,
identity sequences and a small builtin/type allowlist, plus the separately
full-matched rc.5 PostgreSQL generator form:

```sql
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_business_id_business_settings_id_fk" FOREIGN KEY ("business_id") REFERENCES "business_settings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
```

This is a source-shaped example, not an actual #81 migration. FK table/constraint/
column identifiers must be quoted, safe and unqualified (column lists may be
composite); both actions must be exactly `ON DELETE RESTRICT ON UPDATE RESTRICT`.
The same RESTRICT reference clause is supported inline in CREATE. For minute
precision, CREATE checks may use builtin `EXTRACT(SECOND FROM "column")` on a
simple unqualified column, not arbitrary EXTRACT expressions/functions.
General ALTER (including ADD COLUMN, DROP, RENAME, VALIDATE), other FK actions or
extra ALTER clauses, schema qualification, secondary statements, procedural/
session SQL, comments/escapes and unsupported calls/constructs fail closed.
Only the scaffold migration is currently committed; fixtures do not prove future
catalog SQL. This is trusted repository test code, **not an arbitrary-SQL sandbox**:
the coordinator must inspect every actual new generated migration (including
#81) before execution; unsupported forms require a separate reviewed extension
to the guard.

Finally both sessions are rolled back, all held clients are released/destroyed,
and every owned pool gets an awaited close attempt even after failures. The sole
DROP authority is the freshly created schema after exact database and retained
schema identity revalidation; mismatch means refusal, never a broader deletion.
Parallel siblings, public, proof and unknown/crashed schemas are never swept or
adopted. Unknown leftovers require separate reviewed cleanup, not a rerun/reset.
Original callback failures are rethrown unchanged; secondary cleanup failures
emit only `test_database_cleanup_failed`. Cleanup-only failures reject with
`Test database cleanup failed`; setup/migration failures have fixed safe messages.
Callback/query errors can still contain SQL/driver causes: never print or serialize
them, parameters, credentials or PII. This command never repoints app-only
`db:migrate`/`db:smoke`, changes shared data or manages the database volume.

### Authenticated SQL, isolation, extension and persistence check

After installing the pinned dependencies, run the following with Node. It reads
secrets from the ignored file, not CLI arguments. It creates the dedicated
`task56_provisioning_proof` schema in each matching database, containing only fictional data, and
retains it for restart verification. No existing tables are changed or removed.
A repeat in the same checkout intentionally refuses existing proof schemas.

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import pg from 'pg';
const env = dotenv.parse(readFileSync('.env.local'));
const proof = 'task56_provisioning_proof';
for (const [key, role, other] of [
  ['DATABASE_URL', 'slotwell_app', 'slotwell_test'],
  ['TEST_DATABASE_URL', 'slotwell_test', 'slotwell_dev'],
]) {
  const client = new pg.Client({ connectionString: env[key], connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    assert.equal((await client.query('SELECT current_user AS role')).rows[0].role, role);
    await client.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
    assert.equal((await client.query("SELECT extname FROM pg_extension WHERE extname = 'btree_gist'")).rowCount, 1);
    await client.query(`CREATE SCHEMA ${proof}`);
    await client.query(`CREATE TABLE ${proof}.persistence (value text NOT NULL)`);
    await client.query(`INSERT INTO ${proof}.persistence VALUES ($1)`, ['fictional-task56-proof']);
    assert.equal((await client.query(`SELECT value FROM ${proof}.persistence`)).rows[0].value, 'fictional-task56-proof');
  } finally { await client.end(); }
  for (const database of [other, 'postgres', 'template1']) {
    const url = new URL(env[key]);
    url.pathname = '/' + database;
    const denied = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
    try { await assert.rejects(denied.connect(), { code: '42501' }); }
    finally { await denied.end(); }
  }
}
console.log('Authenticated writes, btree_gist and cross/maintenance isolation passed');
JS

docker compose --env-file .env.local restart postgres
docker compose --env-file .env.local up -d --wait postgres

node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import pg from 'pg';
const env = dotenv.parse(readFileSync('.env.local'));
const proof = 'task56_provisioning_proof';
for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL']) {
  const client = new pg.Client({ connectionString: env[key], connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    assert.equal((await client.query(`SELECT value FROM ${proof}.persistence`)).rows[0].value, 'fictional-task56-proof');
  } finally { await client.end(); }
}
console.log('Both fictional proof values survived restart');
JS

npm_config_yes=false npm_config_offline=true npx hono --help
```

### Safe lifecycle and reset boundary

All commands use the same project and credential file:

```sh
docker compose --env-file .env.local stop postgres
docker compose --env-file .env.local start postgres
docker compose --env-file .env.local restart postgres
# Remove containers/network, KEEP named volume and data:
docker compose --env-file .env.local down
```

Restart policy is `no`; start deliberately after a machine/Docker restart. Keep
`.env.local` with the volume: changing its passwords does not rotate stored role
passwords on an initialized volume. Never swap PostgreSQL major versions against
existing data; image digest/security updates require deliberate review.

**No routine reset or automatic deletion is provided.** Do not use `down -v`,
volume prune, or remove the shared volume for test cleanup. Reset requires
separate explicit approval, exact project/volume confirmation, inspection of
volume labels (`dev.slotwell.project=slotwell-m1`,
`dev.slotwell.purpose=local-development-and-test-postgresql18`) and matching
database ownership comments, plus a backup and data-loss acknowledgment.
Mismatched/missing ownership evidence means stop, not broaden the target.

## Booking demo

The Bulgarian demo represents **Студио за красота Нюанс**, with 12 illustrative hair and
massage services. Мими Ибрамова and Павел Добранов provide haircuts and complementary
hair services; Емил Стойков provides massages. Portraits supplied for the demo are
stored in `public/staff/` so rendering does not depend on expiring CDN links.
Prices, address, working hours and visits are sample data, not a real price list.

`src/app/_lib/booking/fixtures.ts` generates a rolling fortnight of occupied visits
from the injected Sofia date, alongside shorter shifts, days off and a dated
studio closure. Occupancy includes cleanup and contains no client identities.
Hair and massage services cannot be combined in one booking because the wizard
requires one specialist to perform every selected service. Bookings remain in
page memory only; reloading resets the demo session.

Focused browser verification: `npx playwright test e2e/booking-wellness.spec.ts`
(after `npm run build`).

The date/time step follows D3 and S1/S2/S6 in `docs/booking-wizard-design.html`:
- Seven-day paging and a Bulgarian calendar share the existing availability selector (one-hour lead time, today through 60 days ahead).
- Morning/afternoon counts and the selected visit range use Sofia time; the displayed end excludes cleanup.
- Empty dates offer the next available day, specialist changes, and service edits. Paging alone never changes the booking.
- Availability is synchronous in this demo. `TimeStep` accepts `loading` for the S1 slot skeleton; no artificial loading delay is introduced.

Success and recovery follow D6/M6 and S4/S5:
- Confirmation includes visit and contact details, demo limitations, and a new-booking action; focus moves to the success heading. Contact notes remain visible on mobile rather than being dropped from the compact specimen.
- Invalidation displays the reducer's explanation and retains contact data. Switching routes explains when the existing choice is preserved; it never invents a replacement.
- Below the desktop breakpoint, “Виж избора” opens a modal summary sheet. Escape restores focus to its trigger; editing closes it and focuses the destination step. Scroll padding keeps keyboard focus above the fixed summary dock.
- Mobile e2e checks cover 360/390px layouts, 44px hit areas (including calendar and validation links), text contrast, focus, and horizontal overflow.

## Approved prototype checkpoint

The current frontend has been accepted for integration. `ReservationSummaryCard`
is shared by every booking step, the mobile summary sheet, and appointment review;
contact details remain a separate review section. UI copy and business identity
centralization for multilingual support are tracked in [#52](https://github.com/PavelDobranov/slotwell/issues/52).

Verification at this checkpoint: production build and type checks pass, 119 unit
tests pass, and the focused summary-design/wellness browser run passes (4 tests).
Lint passes with three existing reduced-motion CSS `!important` warnings. A broader
browser run encountered failures and timed out; full regression/accessibility
sign-off, magnification checks, and independent salon/visitor validation are not
claimed. Administrative closure of historical tickets does not complete those
checks or the persisted MVP/backend milestones. Bookings remain frontend-only.

## Checks and production

```sh
npm run lint
npx tsc --noEmit
npm run test:unit
npm run build
npm run test:e2e
npm start
```
