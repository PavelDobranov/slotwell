import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { sql } from "drizzle-orm";

import { openBrowserTestDatabase } from "@/db/browser-test";
import { withTestDatabase } from "@/db/testing";

async function withAttachment(
  run: (env: Record<string, string | undefined>) => Promise<void>,
) {
  await withTestDatabase({}, async ({ db }) => {
    const [schema] = await db.execute(
      sql`SELECT nspname AS name, oid,
      pg_catalog.pg_get_userbyid(nspowner) AS owner,
      pg_catalog.obj_description(oid, 'pg_namespace') AS nonce
      FROM pg_catalog.pg_namespace WHERE nspname = current_schema()`,
      "objects",
    );
    await run({
      SLOTWELL_BROWSER_TEST: "private-schema-v1",
      SLOTWELL_BROWSER_SCHEMA: JSON.stringify(schema),
      DATABASE_URL: process.env.TEST_DATABASE_URL,
    });
  });
}

test("browser pool connections and a separate application process share only their owner's schema", async () => {
  await withAttachment(async (env) => {
    const handle = openBrowserTestDatabase(env);
    try {
      const clients = await Promise.all([
        handle.pool.connect(),
        handle.pool.connect(),
      ]);
      try {
        await clients[0].query(
          "INSERT INTO scaffold_checks(label) VALUES ('browser-owner')",
        );
        const pids: number[] = [];
        for (const client of clients) {
          const { rows } = await client.query(
            "SELECT current_schema() AS name, current_setting('search_path') AS path, pg_backend_pid() AS pid, current_setting('statement_timeout') AS timeout, label FROM scaffold_checks",
          );
          assert.equal(
            rows[0].name,
            JSON.parse(env.SLOTWELL_BROWSER_SCHEMA ?? "").name,
          );
          assert.equal(rows[0].path, rows[0].name);
          assert.equal(rows[0].label, "browser-owner");
          assert.equal(rows[0].timeout, "5s");
          pids.push(rows[0].pid);
        }
        assert.notEqual(pids[0], pids[1]);
      } finally {
        for (const client of clients) client.release(true);
      }
      const child = spawnSync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `import assert from 'node:assert/strict';
         import { sql } from 'drizzle-orm';
         import { getDatabase, closeDatabase } from './src/db/index.ts';
         try {
           const rows = await getDatabase().execute(sql.raw('SELECT label FROM scaffold_checks'), 'objects');
           assert.deepEqual(rows, [{label:'browser-owner'}]);
         } finally { await closeDatabase(); }
         assert.throws(() => getDatabase(), {message:'Database is closed'});`,
        ],
        { env: { NODE_ENV: "test", ...env }, encoding: "utf8", timeout: 15000 },
      );
      assert.equal(child.error, undefined);
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stdout, "");
      assert.equal(child.stderr, "");
    } finally {
      await handle.close();
    }
  });
});

test("workers have distinct schemas and replacement connections revalidate ownership", async () => {
  await withAttachment(async (firstEnv) => {
    await withAttachment(async (secondEnv) => {
      const first = openBrowserTestDatabase(firstEnv);
      const second = openBrowserTestDatabase(secondEnv);
      const schema = JSON.parse(firstEnv.SLOTWELL_BROWSER_SCHEMA ?? "");
      try {
        assert.notEqual(
          firstEnv.SLOTWELL_BROWSER_SCHEMA,
          secondEnv.SLOTWELL_BROWSER_SCHEMA,
        );
        await first.pool.query(
          "INSERT INTO scaffold_checks(label) VALUES ('first-worker')",
        );
        await second.pool.query(
          "INSERT INTO scaffold_checks(label) VALUES ('second-worker')",
        );
        assert.deepEqual(
          (await first.pool.query("SELECT label FROM scaffold_checks")).rows,
          [{ label: "first-worker" }],
        );
        assert.deepEqual(
          (await second.pool.query("SELECT label FROM scaffold_checks")).rows,
          [{ label: "second-worker" }],
        );
        const client = await first.pool.connect();
        // Alter only this live owner's marker, then restore it before owner cleanup.
        // The checked-out session keeps the pool from reusing an already-validated connection.
        try {
          await client.query(
            `COMMENT ON SCHEMA "${schema.name}" IS 'changed-by-own-test'`,
          );
          await assert.rejects(
            first.pool.connect().then((unexpected) => unexpected.release(true)),
            { message: "Browser test database attachment refused" },
          );
        } finally {
          await client.query(
            `COMMENT ON SCHEMA "${schema.name}" IS '${schema.nonce}'`,
          );
          client.release(true);
        }
        const replacement = await first.pool.connect();
        replacement.release(true);
      } finally {
        await Promise.all([first.close(), second.close()]);
      }
    });
  });
});

test("attachment rejects wrong retained OID and nonce without exposing values", async () => {
  await withAttachment(async (env) => {
    const schema = JSON.parse(env.SLOTWELL_BROWSER_SCHEMA ?? "");
    for (const altered of [
      { ...schema, oid: schema.oid + 1 },
      { ...schema, nonce: `slotwell-test:${"0".repeat(64)}` },
    ]) {
      const handle = openBrowserTestDatabase({
        ...env,
        SLOTWELL_BROWSER_SCHEMA: JSON.stringify(altered),
      });
      try {
        await assert.rejects(
          handle.pool.connect().then((unexpected) => unexpected.release(true)),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.equal(
              error.message,
              "Browser test database attachment refused",
            );
            assert.equal(error.cause, undefined);
            assert.doesNotMatch(String(error.stack), new RegExp(schema.name));
            return true;
          },
        );
      } finally {
        await handle.close();
      }
    }
  });
});
