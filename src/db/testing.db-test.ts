import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { type SQL, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import { withTestDatabase } from "@/db/testing";

async function rows(db: NodePgDatabase, query: SQL) {
  return db.execute(query, "objects");
}
async function sharedObjects(db: NodePgDatabase) {
  return rows(
    db,
    sql`SELECT n.nspname, n.oid, n.nspowner,
    pg_catalog.obj_description(n.oid, 'pg_namespace') AS comment,
    c.oid AS object_oid, c.relname, c.relkind
    FROM pg_catalog.pg_namespace n LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid
    WHERE n.nspname IN ('public', 'task56_provisioning_proof', 'drizzle')
    ORDER BY n.nspname, c.oid`,
  );
}
async function absent(db: NodePgDatabase, name: string, pids: number[] = []) {
  assert.equal(
    (
      await rows(
        db,
        sql`SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = ${name}`,
      )
    ).length,
    0,
  );
  for (const pid of pids) {
    assert.equal(
      (
        await rows(
          db,
          sql`SELECT pid FROM pg_catalog.pg_stat_activity WHERE pid = ${pid}`,
        )
      ).length,
      0,
    );
  }
}

test("booking occupancy alterations preserve blocks and enforce kind/unique associations privately", async () => {
  await withTestDatabase({}, async ({ db }) => {
    // Test PostgreSQL alteration semantics on an owned probe so this test
    // remains valid after the actual booking migration lands. Only identifiers
    // differ from the exact original-statement preflight unit fixtures.
    await db.execute(sql`CREATE TABLE occupancy_alter_probe
      (staff_id text NOT NULL, period tstzrange NOT NULL, kind text NOT NULL)`);
    await db.execute(sql`INSERT INTO occupancy_alter_probe (staff_id, period, kind)
      VALUES ('guard-probe', tstzrange('2030-01-01 09:00Z', '2030-01-01 10:00Z', '[)'), 'block')`);
    await db.execute(
      sql`ALTER TABLE "occupancy_alter_probe" ADD COLUMN "appointment_id" uuid`,
    );
    await db.execute(
      sql`ALTER TABLE "occupancy_alter_probe" ADD CONSTRAINT "occupancy_alter_probe_appointment_id_unique" UNIQUE("appointment_id")`,
    );
    await db.execute(
      sql`ALTER TABLE "occupancy_alter_probe" ADD CONSTRAINT "occupancy_alter_probe_appointment_kind" CHECK (("kind" = 'appointment') = ("appointment_id" IS NOT NULL))`,
    );
    assert.deepEqual(
      await rows(
        db,
        sql`SELECT kind, appointment_id FROM occupancy_alter_probe`,
      ),
      [{ kind: "block", appointment_id: null }],
    );
    const violation = (code: string) => (error: unknown) => {
      let cause = error;
      while (cause instanceof Error) {
        if ("code" in cause && cause.code === code) return true;
        cause = cause.cause;
      }
      return false;
    };
    for (const [kind, appointment] of [
      ["appointment", null],
      ["block", "00000000-0000-4000-8000-000000000086"],
    ]) {
      await assert.rejects(
        db.execute(sql`INSERT INTO occupancy_alter_probe (staff_id, period, kind, appointment_id)
        VALUES ('guard-probe', tstzrange('2030-01-01 10:00Z', '2030-01-01 11:00Z', '[)'), ${kind}, ${appointment})`),
        violation("23514"),
      );
    }
    await db.execute(sql`INSERT INTO occupancy_alter_probe (staff_id, period, kind, appointment_id)
      VALUES ('guard-probe', tstzrange('2030-01-01 10:00Z', '2030-01-01 11:00Z', '[)'), 'appointment', '00000000-0000-4000-8000-000000000086')`);
    await assert.rejects(
      db.execute(sql`INSERT INTO occupancy_alter_probe (staff_id, period, kind, appointment_id)
      VALUES ('guard-probe', tstzrange('2030-01-01 11:00Z', '2030-01-01 12:00Z', '[)'), 'appointment', '00000000-0000-4000-8000-000000000086')`),
      violation("23505"),
    );
  });
});

// Never create/drop shared sentinels: a second live harness is the sibling owner.
// Snapshot shared identities without adopting or depending on developer data.
test("real migrations twice, private ledger/search paths, independent held sessions, fixed clock and closed resources", async () => {
  await withTestDatabase({}, async ({ db: observer }) => {
    const before = await sharedObjects(observer);
    let name = "";
    const pids: number[] = [];
    const result = await withTestDatabase(
      { now: 1800000000123 },
      async ({ db, independentDb, migrate, now }) => {
        assert.equal(now, 1800000000123);
        for (const handle of [db, independentDb]) {
          const row = (
            await rows(
              handle,
              sql`SELECT current_schema() AS schema, current_setting('search_path') AS path, pg_backend_pid() AS pid`,
            )
          )[0];
          assert.match(String(row.schema), /^slotwell_test_[a-f0-9]{32}$/);
          if (name) assert.equal(row.schema, name);
          name = String(row.schema);
          assert.equal(row.path, name);
          pids.push(Number(row.pid));
        }
        assert.notEqual(pids[0], pids[1]);
        const ledger = await rows(
          db,
          sql`SELECT * FROM __drizzle_migrations ORDER BY id`,
        );
        assert.ok(ledger.length > 0);
        await migrate();
        assert.deepEqual(
          await rows(db, sql`SELECT * FROM __drizzle_migrations ORDER BY id`),
          ledger,
        );
        const tables = await rows(
          db,
          sql`SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = current_schema()`,
        );
        assert.ok(tables.some((row) => row.table_name === "scaffold_checks"));
        assert.ok(
          tables.some((row) => row.table_name === "__drizzle_migrations"),
        );
        assert.ok(tables.every((row) => row.table_schema === name));
        await db.execute(
          sql`INSERT INTO scaffold_checks (label) VALUES ('fictional isolation sentinel')`,
        );
        assert.equal(
          (await rows(independentDb, sql`SELECT label FROM scaffold_checks`))[0]
            .label,
          "fictional isolation sentinel",
        );
        await db.execute(sql`BEGIN`);
        await db.execute(
          sql`INSERT INTO scaffold_checks (label) VALUES ('uncommitted')`,
        );
        assert.equal(
          (
            await rows(
              independentDb,
              sql`SELECT count(*)::int AS count FROM scaffold_checks`,
            )
          )[0].count,
          1,
        );
        await independentDb.execute(sql`BEGIN`);
        return "callback result";
      },
    );
    assert.equal(result, "callback result");
    await absent(observer, name, pids);
    assert.deepEqual(await sharedObjects(observer), before);
  });
});

test("concurrent runs cannot see each other's private rows and sibling cleanup preserves live data", async () => {
  let ready!: () => void;
  let finish!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const release = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const first = withTestDatabase({}, async ({ db }) => {
    await db.execute(
      sql`INSERT INTO scaffold_checks (label) VALUES ('sibling kept')`,
    );
    ready();
    await release;
    assert.equal(
      (await rows(db, sql`SELECT label FROM scaffold_checks`))[0].label,
      "sibling kept",
    );
  });
  try {
    // A failed first setup must reject rather than leave this test waiting.
    await Promise.race([started, first]);
    await withTestDatabase({}, async ({ db }) => {
      assert.equal(
        (
          await rows(
            db,
            sql`SELECT count(*)::int AS count FROM scaffold_checks`,
          )
        )[0].count,
        0,
      );
      await db.execute(
        sql`INSERT INTO scaffold_checks (label) VALUES ('separate run')`,
      );
    });
  } finally {
    finish();
    await first;
  }
});

test("callback and real repeat-migration failures remove only their owned schemas and close both sessions", async () => {
  await withTestDatabase({}, async ({ db: observer }) => {
    await observer.execute(
      sql`INSERT INTO scaffold_checks (label) VALUES ('live sibling')`,
    );
    const before = await sharedObjects(observer);
    for (const failure of ["callback", "migration"]) {
      let name = "";
      const pids: number[] = [];
      const original = new Error("fictional callback failure");
      await assert.rejects(
        withTestDatabase({}, async ({ db, independentDb, migrate }) => {
          name = String(
            (await rows(db, sql`SELECT current_schema() AS name`))[0].name,
          );
          for (const handle of [db, independentDb])
            pids.push(
              Number(
                (await rows(handle, sql`SELECT pg_backend_pid() AS pid`))[0]
                  .pid,
              ),
            );
          if (failure === "migration") {
            // Damage only this run's ledger. Actual committed CREATE TABLE then
            // fails on its existing private scaffold, not on a fake migrator.
            await db.execute(sql`DROP TABLE __drizzle_migrations`);
            await migrate();
          }
          throw original;
        }),
        (error) =>
          failure === "callback"
            ? error === original
            : (error as Error).message === "Test database migration failed",
      );
      await absent(observer, name, pids);
      assert.equal(
        (await rows(observer, sql`SELECT label FROM scaffold_checks`))[0].label,
        "live sibling",
      );
    }
    assert.deepEqual(await sharedObjects(observer), before);
  });
});

test("committed nonce tampering refuses migration; restored ownership permits exact cleanup; uncommitted tamper rolls back", async () => {
  await withTestDatabase({}, async ({ db: observer }) => {
    let name = "";
    await withTestDatabase({}, async ({ db, migrate }) => {
      const row = (
        await rows(
          db,
          sql`SELECT nspname AS name, pg_catalog.obj_description(oid, 'pg_namespace') AS nonce FROM pg_catalog.pg_namespace WHERE nspname = current_schema()`,
        )
      )[0];
      name = String(row.name);
      const nonce = String(row.nonce);
      assert.match(name, /^slotwell_test_[a-f0-9]{32}$/);
      assert.match(nonce, /^slotwell-test:[a-f0-9]{64}$/);
      try {
        await db.execute(sql.raw(`COMMENT ON SCHEMA "${name}" IS 'tampered'`));
        await assert.rejects(migrate(), {
          message: "Test database migration failed",
        });
      } finally {
        // Restore exact ownership; never drop an unknown/tampered schema.
        await db.execute(sql.raw(`COMMENT ON SCHEMA "${name}" IS '${nonce}'`));
      }
      await migrate();
      await db.execute(sql`BEGIN`);
      await db.execute(
        sql.raw(`COMMENT ON SCHEMA "${name}" IS 'uncommitted tamper'`),
      );
    });
    await absent(observer, name);
  });
});

test("real initial migration failure deletes only fresh schema and closes all clients", async () => {
  await withTestDatabase({}, async ({ db: observer }) => {
    const connect: (this: pg.Pool) => Promise<pg.PoolClient> =
      pg.Pool.prototype.connect;
    const held: pg.PoolClient[] = [];
    const pids: number[] = [];
    let name = "";
    const patched = mock.method(
      pg.Pool.prototype,
      "connect",
      async function (this: pg.Pool) {
        const client = await connect.call(this);
        held.push(client);
        pids.push(
          Number(
            (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
          ),
        );
        client.query = new Proxy(client.query, {
          async apply(target, thisArg, args) {
            const result = await Reflect.apply(target, thisArg, args);
            const text = typeof args[0] === "string" ? args[0] : "";
            if (!name && text.startsWith("SET search_path")) {
              name = text.split('"')[1];
              await Reflect.apply(target, thisArg, [
                'CREATE TABLE "scaffold_checks" (id integer)',
              ]);
            }
            return result;
          },
        });
        return client;
      },
    );
    try {
      await assert.rejects(
        withTestDatabase({}, async () => assert.fail()),
        { message: "Test database setup failed" },
      );
    } finally {
      patched.mock.restore();
    }
    assert.equal(held.length, 2);
    assert.match(name, /^slotwell_test_[a-f0-9]{32}$/);
    await absent(observer, name, pids);
  });
});

// Verifies the environment the occupancy guard (#83) gates for: inside the
// private schema, as the non-superuser test role, the preinstalled btree_gist
// exclusion resolves and enforces a half-open [) overlap invariant. No
// CREATE EXTENSION and no migration are needed here — this proves support, not
// #63's table.
test("private test schema and role enforce the half-open occupancy overlap exclusion", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await db.execute(
      sql`CREATE TABLE "occupancy_probe" (
        "staff_id" text NOT NULL,
        "period" tstzrange NOT NULL,
        CONSTRAINT "occupancy_probe_no_overlap"
          EXCLUDE USING gist ("staff_id" WITH =, "period" WITH &&)
      )`,
    );
    const insert = (staff: string, from: string, to: string) =>
      db.execute(
        sql`INSERT INTO "occupancy_probe" VALUES (${staff}, tstzrange(${from}::timestamptz, ${to}::timestamptz, '[)'))`,
      );
    await insert("mimi", "2026-11-01 10:00+02", "2026-11-01 11:00+02");
    // Boundary-touching adjacency is allowed (half-open ends before it opens).
    await insert("mimi", "2026-11-01 11:00+02", "2026-11-01 12:00+02");
    // A true overlap for the same staff member is rejected by the constraint.
    // Drizzle wraps the driver error, so the exclusion violation is on `cause`.
    await assert.rejects(
      insert("mimi", "2026-11-01 11:30+02", "2026-11-01 12:30+02"),
      (error) =>
        error instanceof Error &&
        /exclusion constraint/i.test(
          String((error.cause as Error | undefined)?.message ?? error.message),
        ),
    );
    // The same interval for a different staff member is independent.
    await insert("pavel", "2026-11-01 11:30+02", "2026-11-01 12:30+02");
    assert.equal(
      (
        await rows(
          db,
          sql`SELECT count(*)::int AS count FROM "occupancy_probe"`,
        )
      )[0].count,
      3,
    );
  });
});

test("real partial CREATE/COMMENT setup failures roll back without acquiring DROP authority", async () => {
  await withTestDatabase({}, async ({ db: observer }) => {
    const before = await sharedObjects(observer);
    for (const stage of ["CREATE SCHEMA", "COMMENT ON SCHEMA"]) {
      const connect: (this: pg.Pool) => Promise<pg.PoolClient> =
        pg.Pool.prototype.connect;
      const pids: number[] = [];
      let name = "";
      let drops = 0;
      let injected = false;
      const patched = mock.method(
        pg.Pool.prototype,
        "connect",
        async function (this: pg.Pool) {
          const client = await connect.call(this);
          pids.push(
            Number(
              (await client.query("SELECT pg_backend_pid() AS pid")).rows[0]
                .pid,
            ),
          );
          client.query = new Proxy(client.query, {
            async apply(target, thisArg, args) {
              const text = typeof args[0] === "string" ? args[0] : "";
              if (text.startsWith("CREATE SCHEMA")) name = text.split('"')[1];
              if (text.startsWith("DROP SCHEMA")) drops++;
              if (text.startsWith(stage)) {
                injected = true;
                throw new Error("fictional setup failure");
              }
              return Reflect.apply(target, thisArg, args);
            },
          });
          return client;
        },
      );
      try {
        await assert.rejects(
          withTestDatabase({}, async () => assert.fail()),
          { message: "Test database setup failed" },
        );
      } finally {
        patched.mock.restore();
      }
      assert.equal(injected, true);
      assert.equal(drops, 0);
      assert.equal(pids.length, 2);
      assert.match(name, /^slotwell_test_[a-f0-9]{32}$/);
      await absent(observer, name, pids);
    }
    assert.deepEqual(await sharedObjects(observer), before);
  });
});
