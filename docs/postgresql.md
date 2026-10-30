# Local PostgreSQL

M1 persists staff-first bookings at `/book`. `/` is a separate in-memory prototype.
This setup is for a trusted local workstation, not cloud deployment or production.
Use Node.js 22.13+, npm, Docker/Compose, and the committed lockfile:

```sh
npm ci --ignore-scripts
```

Review required dependency lifecycle scripts before narrowly approving them; do
not enable all scripts or run an unrestricted rebuild if a binary is missing.

## Credentials and startup

Preserve any existing ignored root `.env.local` and keep it mode `0600`. Never
print it, expanded Compose configuration, database URLs, or booking keys. Inherited
process variables take precedence over the file; stale exported variables can
select the wrong target. The following fresh-checkout command **refuses to overwrite**
an existing file. It generates independent passwords and durable booking keys:

```sh
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const secret = () => randomBytes(32).toString('hex');
const [admin, app, test] = [secret(), secret(), secret()];
const keys = {
  fingerprint: { currentId: 'h1', keys: { h1: secret() } },
  replay: { currentId: 'e1', keys: { e1: secret() } },
};
writeFileSync('.env.local', [
  `POSTGRES_PASSWORD=${admin}`,
  `APP_DB_PASSWORD=${app}`,
  `TEST_DB_PASSWORD=${test}`,
  `DATABASE_URL=postgresql://slotwell_app:${app}@127.0.0.1:55432/slotwell_dev`,
  `TEST_DATABASE_URL=postgresql://slotwell_test:${test}@127.0.0.1:55432/slotwell_test`,
  'SLOTWELL_BOOKING_ORIGIN=http://localhost:3000',
  `SLOTWELL_BOOKING_KEYS='${JSON.stringify(keys)}'`,
  '',
].join('\n'), { flag: 'wx', mode: 0o600 });
JS

docker compose --env-file .env.local config --quiet
docker compose --env-file .env.local up -d --wait postgres
```

`compose.yaml` pins PostgreSQL 18.6 by digest, binds only `127.0.0.1:55432`, and
retains `slotwell-m1-pg18-data` at `/var/lib/postgresql` (PostgreSQL 18's mount,
not the older `/var/lib/postgresql/data`). Leave unrelated databases on 5432 alone.
Health checks prove readiness, not authenticated SQL access. Docker access can
read container secrets; these are local database-owner credentials, not restricted
production runtime roles. Never use the admin role in the application or tests.

## One-time bootstrap

Run only on a freshly initialized project cluster. Preflight refuses existing
target roles/databases. On partial failure, stop for inspection: never adopt,
overwrite, drop/recreate, or retry destructively. Do not run competing bootstraps.
Database creation is not transactional.

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
\connect slotwell_dev
CREATE EXTENSION btree_gist;
\connect slotwell_test
CREATE EXTENSION btree_gist;
SQL
```

The roles have no memberships and cannot connect to each other's or maintenance
databases. `btree_gist` must be installed before occupancy migrations/private-schema
tests. It is a prerequisite, not permission for the test harness to install extensions.

## Migrations, seeds and running

```sh
npm run db:migrate
npm run db:seed
npm run db:seed
npm run db:smoke
npm run dev
```

Open **http://localhost:3000/book** with fictional contact data. Use that exact
origin; `127.0.0.1` is a different origin. If changing host/port, deliberately update
`SLOTWELL_BOOKING_ORIGIN` to match. The health endpoint is `/api/health`; catalog
and availability reads exercise the database. Health alone does not prove booking
configuration or database connectivity.

For a production-mode local run, stop your owned development process, then:

```sh
npm run build
npm start
```

Next loads `.env.local`; migration/seed/smoke scripts load it explicitly. Runtime
configuration is lazy, so a successful build does not prove database access.
Only PostgreSQL is supported: app tools require the matching local
`slotwell_app`/`slotwell_dev` URL; tests require the distinct explicit
`slotwell_test`/`slotwell_test` URL. No SQLite, test-URL fallback, URL query,
`search_path` override or arbitrary remote database target is supported.

`db:migrate` applies committed `drizzle/` migrations and retains its ledger;
repeat invocation should be a no-op. For an intentional schema change, use
`npm run db:generate`, review generated SQL/snapshots and the private migration
inspection gate before applying. Do not regenerate migrations just to start up.

The catalog seed verifies the complete reserved fictional graph. Partial or
changed fixtures fail atomically rather than repairing/overwriting user data.
Schedule seeding adds missing weekly schedules and rolling business-zone
exceptions/blocks, preserves existing rows and appointments, and skips conflicting
blocks. Reseeding does not reset history or overwrite dated fixtures; it is not a
migration or an admin-editing interface. `db:smoke` maintains its dedicated
scaffold proof, not a booking acceptance journey.

## Tests and disposable ownership

Build before `npm run test:db`: database lifecycle tests launch production Next
processes. Unit tests need no database. Integration tests use freshly owned private
schemas within the marked test database, run the committed migrations, and clean
up only their retained name/OID/owner/nonce identity. They do not reset the shared
database, public schema, development data, proof schemas or abandoned schemas.

See [browser testing](browser-testing.md) for production-server lifetime, isolated
worker databases, synthetic data and artifact restrictions. See
[M1 acceptance evidence](m1-acceptance.md) for actual results and remaining gates.

## Safe lifecycle, keys and reset boundary

```sh
docker compose --env-file .env.local stop postgres
docker compose --env-file .env.local start postgres
docker compose --env-file .env.local restart postgres
# Removes service/network, preserves named volume and all database contents:
docker compose --env-file .env.local down
```

The restart policy is `no`; start deliberately after Docker/machine restart.
Retain the credential file with the volume: editing passwords does not rotate
initialized roles. Do not change PostgreSQL major versions against existing data.
Digest/security updates need deliberate review.

**No routine destructive reset is authorized.** Do not use `down -v`, prune volumes,
drop shared databases/schemas, or scan/delete leftovers to make tests pass. A reset
needs separate explicit approval, backup/data-loss acknowledgment, exact target
confirmation, volume labels (`dev.slotwell.project=slotwell-m1` and
`dev.slotwell.purpose=local-development-and-test-postgresql18`) and matching
database ownership comments. Missing/mismatched evidence means stop.

Keep durable booking keys with the matching database and protect backups equally.
Never regenerate keys to troubleshoot unknown outcomes or discard server fences.
Rotation, replay, retention and browser-clear rules have one authoritative home:
[HTTP/key configuration](contracts/booking-http.md),
[retry semantics](contracts/booking-retries.md), and
[browser storage](contracts/booking-browser-storage.md).

## M1 limitations

One business/location; explicit staff-first booking only. `/` remains a labelled
simulation. No persisted time-first flow, admin management, client change actions,
email/SMS delivery, payments, accounts, cloud setup or production-readiness claim.
Confirmation links grant view-only bearer access; keep them private. Contacts stay
in database history and in-memory drafts, not browser persistence. IndexedDB
intentionally retains recovery credentials readable by same-origin JavaScript;
XSS, manual site-data clearing, eviction or device loss remain risks. M1 does not
supply a production PII retention/erasure programme, runtime least-privilege roles,
rate limiting, deployment hardening, or a certified accessibility assessment.
