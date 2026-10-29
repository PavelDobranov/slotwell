// Child application entry for submit-booking.db-test; never discovered as a test.
// Only the parent harness owns migrations, schema lifecycle and cleanup.
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { validateDatabaseUrl } from "@/db/open";
import { readConfirmation, submitBooking } from "@/server/booking";

async function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (!/^slotwell_test_[a-f0-9]{32}$/.test(input.schema)) throw new Error();
  const connectionString = validateDatabaseUrl(process.env.TEST_DATABASE_URL);
  if (new URL(connectionString).username !== "slotwell_test") throw new Error();
  const pool = new pg.Pool({ connectionString, max: 1 });
  pool.on("error", () => {});
  const client = await pool.connect();
  try {
    const identity = await client.query(`SELECT current_database() AS database,
      current_user AS role, pg_catalog.shobj_description(d.oid, 'pg_database') AS comment
      FROM pg_catalog.pg_database d WHERE d.datname = current_database()`);
    const row = identity.rows[0];
    if (
      row.database !== "slotwell_test" ||
      row.role !== "slotwell_test" ||
      row.comment !== "slotwell-m1:test:slotwell_test"
    )
      throw new Error();
    await client.query(`SET search_path TO "${input.schema}"`);
    const db = drizzle({ client, logger: false, paramsInErrors: false });
    const options = {
      keys: {
        fingerprint: { currentId: "h1", keys: { h1: Buffer.alloc(32, 1) } },
        replay: { currentId: "e1", keys: { e1: Buffer.alloc(32, 2) } },
      },
      clock: () => input.now,
    };
    if (input.action === "discard") {
      await submitBooking(db, input.submission, options);
      // The receipt never leaves this process. Exit before recovery is launched.
      return { pid: process.pid };
    }
    if (input.action === "recover") {
      const receipt = await submitBooking(db, input.submission, options);
      const view = await readConfirmation(db, receipt, options.clock);
      return { pid: process.pid, receipt, view };
    }
    if (input.action === "expired") {
      const errorCode = async (action: () => Promise<unknown>) => {
        try {
          await action();
          return "unexpected_success";
        } catch (error) {
          return error instanceof Error &&
            error.message === "operation_unavailable"
            ? "operation_unavailable"
            : error instanceof Error &&
                error.message === "confirmation_unavailable"
              ? "confirmation_unavailable"
              : "unexpected_error";
        }
      };
      return {
        pid: process.pid,
        replay: await errorCode(() =>
          submitBooking(db, input.submission, options),
        ),
        confirmation: await errorCode(() =>
          readConfirmation(db, input.receipt, options.clock),
        ),
      };
    }
    throw new Error();
  } finally {
    client.release();
    await pool.end();
  }
}

main().then(
  (result) => process.stdout.write(JSON.stringify(result)),
  () => {
    process.stderr.write("persistence_worker_failed");
    process.exitCode = 1;
  },
);
