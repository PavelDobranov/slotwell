import "dotenv/config";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { openDatabase } from "@/db/open";
import { scaffoldChecks } from "@/db/schema";

const filename = process.env.DB_FILE_NAME;

if (!filename) {
  throw new Error("DB_FILE_NAME is required");
}

const { sqlite, db } = openDatabase(filename);
try {
  const inserted = db
    .insert(scaffoldChecks)
    .values({ label: "synthetic scaffold check" })
    .returning()
    .get();
  assert.ok(inserted, "SQLite insert returned no row");
  const found = db
    .select()
    .from(scaffoldChecks)
    .where(eq(scaffoldChecks.id, inserted.id))
    .get();
  assert.equal(found?.label, "synthetic scaffold check");
  db.delete(scaffoldChecks).where(eq(scaffoldChecks.id, inserted.id)).run();
  console.log("SQLite write/read/delete passed");
} finally {
  sqlite.close();
}
