import { resolve } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

import { validateDatabaseUrl } from "@/db/open";

config({
  path: resolve(__dirname, ".env.local"),
  quiet: true,
  override: false,
  debug: false,
});
const url = validateDatabaseUrl(process.env.DATABASE_URL);
if (new URL(url).username !== "slotwell_app") {
  throw new Error("Application database required");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
