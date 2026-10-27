import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import pg from "pg";

// Local target validation only; schema isolation/reset authority belongs to the caller.
export function validateDatabaseUrl(value: string | undefined): string {
  try {
    if (!value || /[\s\p{Cc}]/u.test(value) || /[?#]/.test(value)) {
      throw new Error();
    }
    // URL accepts malformed percent escapes; pg decodes them later.
    decodeURIComponent(value);
    const url = new URL(value);
    const password = decodeURIComponent(url.password);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== "127.0.0.1" ||
      url.port !== "55432" ||
      !password ||
      /\p{Cc}/u.test(password) ||
      !(
        (url.username === "slotwell_app" && url.pathname === "/slotwell_dev") ||
        (url.username === "slotwell_test" && url.pathname === "/slotwell_test")
      )
    ) {
      throw new Error();
    }
    return value;
  } catch {
    throw new Error("Invalid database URL");
  }
}

export function openPostgresDatabase(url: string) {
  const connectionString = validateDatabaseUrl(url);
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
  });
  pool.on("error", () => {
    console.error("database_pool_idle_error");
  });
  const db = drizzlePostgres({
    client: pool,
    logger: false,
    paramsInErrors: false,
  });
  let closing: Promise<void> | undefined;

  return {
    pool,
    db,
    close(): Promise<void> {
      // Cache even failures; never retry end() or expose its raw error/cause.
      closing ??= Promise.resolve()
        .then(() => pool.end())
        .catch(() => {
          throw new Error("Database shutdown failed");
        });
      return closing;
    },
  };
}

export function openDatabase(filename: string) {
  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");

  return { sqlite, db: drizzle({ client: sqlite }) };
}
