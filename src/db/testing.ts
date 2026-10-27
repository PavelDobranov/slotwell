import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePostgres } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { validateDatabaseUrl } from "@/db/open";

const root = resolve(__dirname, "../..");
const migrationsFolder = resolve(root, "drizzle");
const databaseComment = "slotwell-m1:test:slotwell_test";
const cleanupDiagnostic = "test_database_cleanup_failed";

type SchemaIdentity = {
  name: string;
  oid: number;
  owner: string;
  nonce: string;
};
type TestContext = {
  db: NodePgDatabase;
  independentDb: NodePgDatabase;
  migrate: () => Promise<void>;
  now: number;
};

// This is a deliberately bounded review gate for trusted repository SQL, NOT an
// arbitrary-SQL sandbox. The committed scaffold was reviewed with rc.5's actual
// migrator: its table and identity sequence names are unqualified. New migration
// constructs (including ALTER/seed SQL) need separate review before support here.
function inspectMigrations() {
  const migrations = readMigrationFiles({ migrationsFolder });
  if (!migrations.length) throw new Error("Unsupported test migration");
  for (const migration of migrations) {
    for (const statement of migration.sql) {
      const code = statement.replace(/'(?:''|[^'\\])*'/g, "''").trim();
      // No comments, escapes, schema qualification, procedural SQL, secondary
      // statements or session/role changes. Never rewrite the executed SQL.
      if (
        !/^CREATE TABLE "[a-z_][a-z0-9_]*"\s*\(/i.test(code) ||
        /[.$\\]|--|\/\*|\*\//.test(code) ||
        /;[\s\S]*\S/.test(code) ||
        /\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|SET|RESET|DO|CALL|COPY|GRANT|REVOKE|SCHEMA|TABLESPACE|INHERITS|PARTITION|LIKE|FUNCTION|PROCEDURE|TRIGGER|RULE)\b/i.test(
          code,
        )
      )
        throw new Error("Unsupported test migration");
      const body = code
        .replace(/^CREATE TABLE "[a-z_][a-z0-9_]*"\s*\(/i, "(")
        .replace(/\bREFERENCES\s+"[a-z_][a-z0-9_]*"\s*\(/gi, "REFERENCES (");
      if (/"\s*\(/.test(body)) throw new Error("Unsupported test migration");
      for (const call of body.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi)) {
        if (
          !/^(?:IDENTITY|CHECK|KEY|UNIQUE|REFERENCES|CHAR|VARCHAR|NUMERIC|TIME|TIMESTAMP|BTRIM|LENGTH)$/i.test(
            call[1],
          )
        ) {
          throw new Error("Unsupported test migration");
        }
      }
    }
  }
}

async function verifyDatabase(client: pg.PoolClient) {
  const { rows } = await client.query(`SELECT current_database() AS database,
    current_user AS role, pg_catalog.pg_get_userbyid(d.datdba) AS owner,
    pg_catalog.shobj_description(d.oid, 'pg_database') AS comment
    FROM pg_catalog.pg_database d WHERE d.datname = current_database()`);
  const identity = rows[0];
  if (
    !identity ||
    identity.database !== "slotwell_test" ||
    identity.role !== "slotwell_test" ||
    identity.owner !== "slotwell_test" ||
    identity.comment !== databaseComment
  )
    throw new Error("Test database identity refused");
}

async function readSchema(
  client: pg.PoolClient,
  name: string,
): Promise<SchemaIdentity | undefined> {
  const { rows } = await client.query(
    `SELECT n.nspname AS name, n.oid,
    pg_catalog.pg_get_userbyid(n.nspowner) AS owner,
    pg_catalog.obj_description(n.oid, 'pg_namespace') AS nonce
    FROM pg_catalog.pg_namespace n WHERE n.nspname = $1`,
    [name],
  );
  return rows[0];
}

async function verifySchema(client: pg.PoolClient, expected: SchemaIdentity) {
  await verifyDatabase(client);
  const actual = await readSchema(client, expected.name);
  if (
    !actual ||
    actual.name !== expected.name ||
    actual.oid !== expected.oid ||
    actual.owner !== expected.owner ||
    actual.nonce !== expected.nonce
  ) {
    throw new Error("Test schema identity refused");
  }
}

/** Owns two held connections and only its fresh private schema; never use after callback. */
export async function withTestDatabase<T>(
  options: { now?: number },
  callback: (context: TestContext) => Promise<T>,
): Promise<T> {
  dotenv.config({
    path: resolve(root, ".env.local"),
    quiet: true,
    override: false,
    debug: false,
  });
  const connectionString = validateDatabaseUrl(process.env.TEST_DATABASE_URL);
  if (new URL(connectionString).username !== "slotwell_test") {
    throw new Error("Test database required");
  }
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now)) throw new Error("Invalid test clock");

  const pools: pg.Pool[] = [];
  const clients: pg.PoolClient[] = [];
  let owned: SchemaIdentity | undefined;
  let result: T | undefined;
  let failed = false;
  let primary: unknown;
  let inCallback = false;
  let active = true;
  let cleanupFailed = false;
  let connectionFailed = false;
  try {
    // Inspect the ENTIRE set before even the first migration/ledger statement.
    inspectMigrations();
    for (let index = 0; index < 2; index++) {
      const pool = new pg.Pool({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
      });
      pools.push(pool);
      pool.on("error", () => console.error("test_database_pool_idle_error"));
      const client = await pool.connect();
      clients.push(client);
      client.on("error", () => {
        connectionFailed = true;
        console.error("test_database_client_error");
      });
      await verifyDatabase(client);
    }
    const client = clients[0];
    const name = `slotwell_test_${randomUUID().replaceAll("-", "")}`;
    if (!/^slotwell_test_[a-f0-9]{32}$/.test(name))
      throw new Error("Invalid test schema");
    const quoted = `"${name}"`;
    const nonce = `slotwell-test:${randomBytes(32).toString("hex")}`;
    // Atomic create+nonce: partial setup never grants cleanup authority. A
    // collision fails CREATE (no IF NOT EXISTS) and cannot be adopted.
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${quoted}`);
    await client.query(`COMMENT ON SCHEMA ${quoted} IS '${nonce}'`);
    const created = await readSchema(client, name);
    if (
      !created ||
      created.name !== name ||
      created.owner !== "slotwell_test" ||
      created.nonce !== nonce
    ) {
      throw new Error("Test schema creation refused");
    }
    // Retain full evidence before COMMIT too: an ambiguous commit failure must
    // not lose ownership of a schema that the server actually committed.
    owned = { ...created };
    await client.query("COMMIT");
    for (const held of clients)
      await held.query(`SET search_path TO ${quoted}`);
    const db = drizzle({ client, logger: false, paramsInErrors: false });
    const independentDb = drizzle({
      client: clients[1],
      logger: false,
      paramsInErrors: false,
    });
    const migrate = async () => {
      if (!active || !owned) throw new Error("Test database is closed");
      try {
        inspectMigrations();
        await verifySchema(client, owned);
        await client.query(`SET search_path TO ${quoted}`);
        await migratePostgres(db, { migrationsFolder, migrationsSchema: name });
      } catch {
        throw new Error("Test database migration failed");
      }
    };
    await migrate();
    inCallback = true;
    result = await callback({ db, independentDb, migrate, now });
  } catch (error) {
    failed = true;
    primary = inCallback ? error : new Error("Test database setup failed");
  } finally {
    active = false;
    // Roll back BOTH sessions before cleanup (an open sibling transaction may
    // otherwise hold locks needed by DROP). Always destroy released clients.
    const rolledBack = await Promise.allSettled(
      clients.map(async (client) => {
        await client.query("ROLLBACK");
      }),
    );
    cleanupFailed =
      connectionFailed ||
      rolledBack.some((entry) => entry.status === "rejected");
    if (owned && !cleanupFailed) {
      try {
        await verifySchema(clients[0], owned);
        await clients[0].query(`DROP SCHEMA "${owned.name}" CASCADE`);
      } catch {
        cleanupFailed = true;
      }
    }
    // Await socket closure as well as release/pool shutdown. In pg 8.23.1,
    // release(true) removes the pool entry before its socket has finished ending.
    const clientsEnded = await Promise.allSettled(
      clients.map(async (client) => {
        await client.end();
      }),
    );
    cleanupFailed ||= clientsEnded.some((entry) => entry.status === "rejected");
    for (const client of clients) {
      try {
        client.release(true);
      } catch {
        cleanupFailed = true;
      }
    }
    const ended = await Promise.allSettled(
      pools.map(async (pool) => {
        await pool.end();
      }),
    );
    cleanupFailed ||= ended.some((entry) => entry.status === "rejected");
  }
  if (cleanupFailed) {
    if (failed) console.error(cleanupDiagnostic);
    else throw new Error("Test database cleanup failed");
  }
  if (failed) throw primary;
  return result as T;
}
