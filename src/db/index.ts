import "server-only";

import {
  openPostgresDatabase,
  validateApplicationDatabaseUrl,
} from "@/db/open";

let handle: ReturnType<typeof openPostgresDatabase> | undefined;
let closing: Promise<void> | undefined;

export function getDatabase() {
  if (closing) {
    throw new Error("Database is closed");
  }
  if (!handle) {
    const url = validateApplicationDatabaseUrl(process.env.DATABASE_URL);
    handle = openPostgresDatabase(url);
  }
  return handle.db;
}

// Terminal even before first use; never create resources just to close them.
export function closeDatabase(): Promise<void> {
  closing ??= handle ? handle.close() : Promise.resolve();
  return closing;
}
