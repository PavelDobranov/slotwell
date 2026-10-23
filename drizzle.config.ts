import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const filename = process.env.DB_FILE_NAME;

if (!filename) {
  throw new Error("DB_FILE_NAME is required");
}

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: filename },
});
