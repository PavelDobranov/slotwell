import { resolve } from "node:path";
import { config } from "dotenv";

import { openPostgresDatabase, validateDatabaseUrl } from "@/db/open";
import { seedCatalog } from "@/db/seed";

async function main() {
  config({
    path: resolve(__dirname, "../.env.local"),
    quiet: true,
    override: false,
    debug: false,
  });
  if (process.argv.length !== 2) throw new Error("No seed arguments allowed");
  const url = validateDatabaseUrl(process.env.DATABASE_URL);
  if (new URL(url).username !== "slotwell_app") {
    throw new Error("Application database required");
  }
  const database = openPostgresDatabase(url);
  try {
    await seedCatalog(database.db);
  } finally {
    await database.close();
  }
  console.log("Catalog seed passed");
}

void main().catch(() => {
  // Never expose query text, driver causes, input URLs or credentials.
  console.error("Catalog seed failed");
  process.exitCode = 1;
});
