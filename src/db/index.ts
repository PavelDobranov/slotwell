import "server-only";

import { openDatabase } from "@/db/open";

const filename = process.env.DB_FILE_NAME;

if (!filename) {
  throw new Error("DB_FILE_NAME is required");
}

export const { db } = openDatabase(filename);
