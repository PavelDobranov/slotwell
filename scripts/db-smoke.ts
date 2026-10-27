import assert from "node:assert/strict";
import { resolve } from "node:path";
import { config } from "dotenv";
import { eq } from "drizzle-orm";

import { openPostgresDatabase, validateDatabaseUrl } from "@/db/open";
import { scaffoldChecks } from "@/db/schema";

async function main() {
  config({
    path: resolve(__dirname, "../.env.local"),
    quiet: true,
    override: false,
    debug: false,
  });
  const url = validateDatabaseUrl(process.env.DATABASE_URL);
  if (new URL(url).username !== "slotwell_app") {
    throw new Error("Application database required");
  }

  const writer = openPostgresDatabase(url);
  let reader: ReturnType<typeof openPostgresDatabase> | undefined;
  let insertedId: number | undefined;
  let failed = false;
  try {
    reader = openPostgresDatabase(url);
    const [inserted] = await writer.db
      .insert(scaffoldChecks)
      .values({ label: "synthetic scaffold check" })
      .returning();
    assert.ok(inserted);
    insertedId = inserted.id;
    // No transaction: the second owned pool must observe the committed insert.
    const [found] = await reader.db
      .select()
      .from(scaffoldChecks)
      .where(eq(scaffoldChecks.id, insertedId));
    assert.equal(found?.id, insertedId);
    assert.equal(found?.label, "synthetic scaffold check");
  } catch {
    failed = true;
  } finally {
    try {
      if (insertedId !== undefined) {
        await writer.db
          .delete(scaffoldChecks)
          .where(eq(scaffoldChecks.id, insertedId));
      }
    } catch {
      failed = true;
    } finally {
      // allSettled awaits both shutdowns, even if either one rejects.
      const closed = await Promise.allSettled([
        writer.close(),
        reader?.close(),
      ]);
      failed ||= closed.some((result) => result.status === "rejected");
    }
  }
  if (failed) {
    throw new Error("PostgreSQL smoke failed");
  }
  console.log("PostgreSQL write/read/delete passed");
}

void main().catch(() => {
  // Drizzle errors can contain SQL and causes; never expose the internal error.
  console.error("PostgreSQL smoke failed");
  process.exitCode = 1;
});
