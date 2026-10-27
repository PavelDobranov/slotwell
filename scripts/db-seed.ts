import { resolve } from "node:path";
import { config } from "dotenv";

import {
  openPostgresDatabase,
  validateApplicationDatabaseUrl,
} from "@/db/open";
import { seedCatalog, seedSchedules } from "@/db/seed";

async function main() {
  config({
    path: resolve(__dirname, "../.env.local"),
    quiet: true,
    override: false,
    debug: false,
  });
  if (process.argv.length !== 2) throw new Error("No seed arguments allowed");
  const url = validateApplicationDatabaseUrl(process.env.DATABASE_URL);
  const database = openPostgresDatabase(url);
  try {
    await seedCatalog(database.db);
    // Inject the real clock as the business-local calendar anchor for rolling
    // schedules/exceptions/blocks; the seed resolves it in the configured zone.
    await seedSchedules(database.db, { anchor: Date.now() });
  } finally {
    await database.close();
  }
  console.log("Seed passed");
}

void main().catch(() => {
  // Never expose query text, driver causes, input URLs or credentials.
  console.error("Catalog seed failed");
  process.exitCode = 1;
});
