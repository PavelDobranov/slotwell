import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { validateDatabaseUrl } from "@/db/open";

type SchemaIdentity = {
  name: string;
  oid: number;
  owner: string;
  nonce: string;
};

/** Local trusted-SQL test attachment, not a sandbox against the same database role. */
export function openBrowserTestDatabase(
  env: Readonly<Record<string, string | undefined>>,
) {
  let connectionString: string;
  let schema: SchemaIdentity;
  try {
    if (env.SLOTWELL_BROWSER_TEST !== "private-schema-v1") throw new Error();
    connectionString = validateDatabaseUrl(env.DATABASE_URL);
    if (new URL(connectionString).username !== "slotwell_test")
      throw new Error();
    const value = JSON.parse(env.SLOTWELL_BROWSER_SCHEMA ?? "null");
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "name,nonce,oid,owner" ||
      typeof value.name !== "string" ||
      !/^slotwell_test_[a-f0-9]{32}$/.test(value.name) ||
      !Number.isSafeInteger(value.oid) ||
      value.oid <= 0 ||
      value.oid > 4294967295 ||
      value.owner !== "slotwell_test" ||
      typeof value.nonce !== "string" ||
      !/^slotwell-test:[a-f0-9]{64}$/.test(value.nonce)
    )
      throw new Error();
    schema = {
      name: value.name,
      oid: value.oid,
      owner: value.owner,
      nonce: value.nonce,
    };
  } catch {
    throw new Error("Browser test database configuration refused");
  }

  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    // Override inherited PGOPTIONS, including search_path. pg_catalog is implicit;
    // public is deliberately absent. These also bound awaited onConnect queries.
    options: `-c search_path=${schema.name}`,
    statement_timeout: 5000,
    query_timeout: 6000,
    onConnect: async (client) => {
      try {
        const { rows } = await client.query(
          `SELECT pg_catalog.current_database() AS database, current_user AS role,
           pg_catalog.pg_get_userbyid(d.datdba) AS database_owner,
           pg_catalog.shobj_description(d.oid, 'pg_database') AS database_comment,
           n.nspname AS name, n.oid, pg_catalog.pg_get_userbyid(n.nspowner) AS owner,
           pg_catalog.obj_description(n.oid, 'pg_namespace') AS nonce
           FROM pg_catalog.pg_database d, pg_catalog.pg_namespace n
           WHERE d.datname = pg_catalog.current_database() AND n.nspname = $1`,
          [schema.name],
        );
        const actual = rows[0];
        if (
          !actual ||
          actual.database !== "slotwell_test" ||
          actual.role !== "slotwell_test" ||
          actual.database_owner !== "slotwell_test" ||
          actual.database_comment !== "slotwell-m1:test:slotwell_test" ||
          actual.name !== schema.name ||
          actual.oid !== schema.oid ||
          actual.owner !== schema.owner ||
          actual.nonce !== schema.nonce
        )
          throw new Error();
        await client.query(`SET search_path TO "${schema.name}"`);
      } catch {
        throw new Error("Browser test database attachment refused");
      }
    },
  });
  pool.on("error", () =>
    console.error("browser_test_database_pool_idle_error"),
  );
  const db = drizzle({ client: pool, logger: false, paramsInErrors: false });
  let closing: Promise<void> | undefined;
  return {
    pool,
    db,
    close(): Promise<void> {
      closing ??= Promise.resolve()
        .then(() => pool.end())
        .catch(() => {
          throw new Error("Database shutdown failed");
        });
      return closing;
    },
  };
}
