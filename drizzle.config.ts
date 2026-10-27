import { resolve } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

import { validateApplicationDatabaseUrl } from "@/db/open";

config({
  path: resolve(__dirname, ".env.local"),
  quiet: true,
  override: false,
  debug: false,
});
const url = validateApplicationDatabaseUrl(process.env.DATABASE_URL);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
