import assert from "node:assert/strict";
import { test } from "node:test";
import { type SQL, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { withTestDatabase } from "@/db/testing";

const catalogColumns = {
  business_settings: [
    "id",
    "name",
    "address",
    "time_zone",
    "default_phone_country",
    "currency",
    "lead_time_minutes",
    "horizon_days",
  ],
  business_hours: [
    "business_id",
    "weekday",
    "window_index",
    "opens_at",
    "closes_at",
  ],
  services: [
    "id",
    "name",
    "category",
    "price_cents",
    "currency",
    "duration_minutes",
    "cleanup_minutes",
    "is_active",
    "sort_order",
  ],
  staff: ["id", "name", "description", "image_url", "is_active", "sort_order"],
  staff_services: ["staff_id", "service_id"],
};

async function rows(db: NodePgDatabase, query: SQL) {
  return db.execute(query, "objects");
}

// Driver errors can be wrapped by Drizzle; assert SQLSTATE/constraint, never
// accept a missing table or an unrelated SQL failure as constraint evidence.
function violation(code: string, constraint?: string) {
  return (error: unknown): boolean => {
    let current = error;
    while (current instanceof Error) {
      if ("code" in current && current.code === code) {
        if (constraint) {
          assert.ok("constraint" in current);
          assert.equal(current.constraint, constraint);
        }
        return true;
      }
      current = current.cause;
    }
    return false;
  };
}

async function insertCatalog(db: NodePgDatabase) {
  await db.execute(sql`INSERT INTO business_settings
    (id, name, address, time_zone, default_phone_country, currency, lead_time_minutes, horizon_days)
    VALUES (1, 'Fictional studio', 'Fictional address', 'Europe/Paris', 'BG', 'EUR', 0, 0)`);
  await db.execute(sql`INSERT INTO business_hours
    (business_id, weekday, window_index, opens_at, closes_at)
    VALUES (1, 1, 0, '09:00', '18:00')`);
  await db.execute(sql`INSERT INTO services
    (id, name, category, price_cents, currency, duration_minutes, cleanup_minutes, sort_order)
    VALUES ('service', 'Fictional service', 'Fictional category', NULL, 'EUR', 1, 0, 0)`);
  await db.execute(sql`INSERT INTO staff (id, name, description, sort_order)
    VALUES ('person', 'Fictional person', 'Fictional description', 0)`);
  await db.execute(sql`INSERT INTO staff_services (staff_id, service_id)
    VALUES ('person', 'service')`);
}

test("committed catalog migrations repeat privately; sibling data survives and owned tables/ledger are cleaned", async () => {
  await withTestDatabase({}, async ({ db: observer }) => {
    await observer.execute(
      sql`INSERT INTO scaffold_checks (label) VALUES ('catalog sibling')`,
    );
    let schema = "";
    await withTestDatabase({}, async ({ db, independentDb, migrate }) => {
      schema = String(
        (await rows(db, sql`SELECT current_schema() AS name`))[0].name,
      );
      const tables = await rows(
        db,
        sql`SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() ORDER BY table_name`,
      );
      assert.deepEqual(
        tables.map((row) => row.table_name),
        [
          "__drizzle_migrations",
          "business_hours",
          "business_settings",
          "scaffold_checks",
          "services",
          "staff",
          "staff_services",
        ],
      );
      for (const table of Object.keys(catalogColumns)) {
        assert.equal(
          (
            await rows(
              db,
              sql`SELECT count(*)::int AS count FROM ${sql.identifier(table)}`,
            )
          )[0].count,
          0,
        );
      }
      const ledger = await rows(
        db,
        sql`SELECT * FROM __drizzle_migrations ORDER BY id`,
      );
      assert.equal(ledger.length, 2);
      await insertCatalog(db);
      await migrate();
      assert.deepEqual(
        await rows(db, sql`SELECT * FROM __drizzle_migrations ORDER BY id`),
        ledger,
      );
      assert.equal(
        (
          await rows(
            independentDb,
            sql`SELECT count(*)::int AS count FROM staff_services`,
          )
        )[0].count,
        1,
      );
      assert.equal(
        (
          await rows(
            observer,
            sql`SELECT count(*)::int AS count FROM staff_services`,
          )
        )[0].count,
        0,
      );
      const privateRelations = await rows(
        db,
        sql`SELECT n.nspname FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relnamespace = pg_catalog.to_regnamespace(current_schema())`,
      );
      assert.ok(privateRelations.length > 7);
      assert.ok(privateRelations.every((row) => row.nspname === schema));
    });
    assert.equal(
      (
        await rows(
          observer,
          sql`SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = ${schema}`,
        )
      ).length,
      0,
    );
    assert.deepEqual(
      await rows(observer, sql`SELECT label FROM scaffold_checks`),
      [{ label: "catalog sibling" }],
    );
  });
});

test("catalog has exact columns, required nullability, nullable variable price/portrait and active defaults", async () => {
  await withTestDatabase({}, async ({ db }) => {
    for (const [table, columns] of Object.entries(catalogColumns)) {
      const actual = await rows(
        db,
        sql`SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ${table} ORDER BY ordinal_position`,
      );
      assert.deepEqual(
        actual.map((row) => row.column_name),
        columns,
      );
      for (const column of actual) {
        const nullable =
          (table === "services" && column.column_name === "price_cents") ||
          (table === "staff" && column.column_name === "image_url");
        assert.equal(column.is_nullable, nullable ? "YES" : "NO");
      }
    }
    const expectedTypes: Record<string, string[]> = {
      business_settings: [
        "smallint",
        "text",
        "text",
        "text",
        "character(2)",
        "character(3)",
        "integer",
        "integer",
      ],
      business_hours: [
        "smallint",
        "smallint",
        "integer",
        "time(0) without time zone",
        "time(0) without time zone",
      ],
      services: [
        "text",
        "text",
        "text",
        "integer",
        "character(3)",
        "integer",
        "integer",
        "boolean",
        "integer",
      ],
      staff: ["text", "text", "text", "text", "boolean", "integer"],
      staff_services: ["text", "text"],
    };
    for (const [table, types] of Object.entries(expectedTypes)) {
      const actual = await rows(
        db,
        sql`SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) AS type
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        WHERE c.relnamespace = pg_catalog.to_regnamespace(current_schema())
          AND c.relname = ${table} AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
      );
      assert.deepEqual(
        actual.map((column) => column.type),
        types,
      );
    }
    await insertCatalog(db);
    assert.deepEqual(
      await rows(
        db,
        sql`SELECT price_cents, currency, is_active FROM services`,
      ),
      [{ price_cents: null, currency: "EUR", is_active: true }],
    );
    assert.deepEqual(
      await rows(db, sql`SELECT image_url, is_active FROM staff`),
      [{ image_url: null, is_active: true }],
    );
    for (const [table, columns] of Object.entries(catalogColumns)) {
      for (const column of columns) {
        if (
          (table === "services" && column === "price_cents") ||
          (table === "staff" && column === "image_url")
        )
          continue;
        await assert.rejects(
          db.execute(
            sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier(column)} = NULL`,
          ),
          violation("23502"),
        );
      }
    }
    await db.execute(
      sql`UPDATE services SET price_cents = 0, is_active = false`,
    );
    await db.execute(
      sql`UPDATE staff SET image_url = '/fictional.jpg', is_active = false`,
    );
    assert.deepEqual(
      await rows(db, sql`SELECT price_cents, is_active FROM services`),
      [{ price_cents: 0, is_active: false }],
    );
    assert.deepEqual(
      await rows(db, sql`SELECT image_url, is_active FROM staff`),
      [{ image_url: "/fictional.jpg", is_active: false }],
    );
    assert.equal(
      (
        await rows(db, sql`SELECT count(*)::int AS count FROM staff_services`)
      )[0].count,
      1,
    );
  });
});

test("named catalog checks reject invalid configuration, blank text, negative values and non-minute clocks", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await insertCatalog(db);
    const cases: [string, string, unknown, string][] = [
      ["business_settings", "id", 2, "business_settings_singleton"],
      ...["name", "address", "time_zone"].map(
        (column): [string, string, unknown, string] => [
          "business_settings",
          column,
          "   ",
          `business_settings_${column}_nonblank`,
        ],
      ),
      [
        "business_settings",
        "default_phone_country",
        "bg",
        "business_settings_phone_country_uppercase",
      ],
      [
        "business_settings",
        "default_phone_country",
        "B1",
        "business_settings_phone_country_uppercase",
      ],
      [
        "business_settings",
        "currency",
        "eur",
        "business_settings_currency_uppercase",
      ],
      [
        "business_settings",
        "currency",
        "EU1",
        "business_settings_currency_uppercase",
      ],
      [
        "business_settings",
        "lead_time_minutes",
        -1,
        "business_settings_lead_time_nonnegative",
      ],
      [
        "business_settings",
        "horizon_days",
        -1,
        "business_settings_horizon_nonnegative",
      ],
      ["business_hours", "weekday", -1, "business_hours_weekday_range"],
      ["business_hours", "weekday", 7, "business_hours_weekday_range"],
      [
        "business_hours",
        "window_index",
        -1,
        "business_hours_window_index_nonnegative",
      ],
      [
        "business_hours",
        "opens_at",
        "09:00:01",
        "business_hours_opens_at_minute",
      ],
      [
        "business_hours",
        "closes_at",
        "18:00:59",
        "business_hours_closes_at_minute",
      ],
      ...["id", "name", "category"].map(
        (column): [string, string, unknown, string] => [
          "services",
          column,
          "   ",
          `services_${column}_nonblank`,
        ],
      ),
      ["services", "price_cents", -1, "services_price_nonnegative"],
      ["services", "currency", "eur", "services_currency_uppercase"],
      ["services", "currency", "EU1", "services_currency_uppercase"],
      ["services", "duration_minutes", 0, "services_duration_positive"],
      ["services", "duration_minutes", -1, "services_duration_positive"],
      ["services", "cleanup_minutes", -1, "services_cleanup_nonnegative"],
      ["services", "sort_order", -1, "services_sort_order_nonnegative"],
      ...["id", "name", "description"].map(
        (column): [string, string, unknown, string] => [
          "staff",
          column,
          "   ",
          `staff_${column}_nonblank`,
        ],
      ),
      ["staff", "sort_order", -1, "staff_sort_order_nonnegative"],
    ];
    for (const [table, column, value, constraint] of cases) {
      await assert.rejects(
        db.execute(
          sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier(column)} = ${value}`,
        ),
        violation("23514", constraint),
      );
    }
    // Boundary values and repeated names are valid; no Sofia-only/global name policy.
    await db.execute(
      sql`UPDATE business_settings SET time_zone = 'America/New_York', lead_time_minutes = 1, horizon_days = 1`,
    );
    await db.execute(
      sql`UPDATE business_hours SET weekday = 0, window_index = 1`,
    );
    await db.execute(
      sql`INSERT INTO business_hours VALUES (1, 6, 0, '10:00', '16:00')`,
    );
    await db.execute(sql`INSERT INTO services (id, name, category, currency, duration_minutes, cleanup_minutes, sort_order)
      SELECT 'second', name, category, currency, duration_minutes, cleanup_minutes, 1 FROM services`);
    await db.execute(sql`INSERT INTO staff (id, name, description, sort_order)
      SELECT 'second', name, description, 1 FROM staff`);
    await db.execute(
      sql`INSERT INTO business_hours VALUES (1, 6, 1, '17:00', '18:00')`,
    );
    await db.execute(
      sql`INSERT INTO staff_services VALUES ('person', 'second'), ('second', 'service')`,
    );
    assert.equal(
      (
        await rows(
          db,
          sql`SELECT count(*)::int AS count FROM business_hours WHERE weekday = 6`,
        )
      )[0].count,
      2,
    );
    assert.equal(
      (
        await rows(db, sql`SELECT count(*)::int AS count FROM staff_services`)
      )[0].count,
      3,
    );
    assert.equal(
      (await rows(db, sql`SELECT count(*)::int AS count FROM services`))[0]
        .count,
      2,
    );
    assert.equal(
      (await rows(db, sql`SELECT count(*)::int AS count FROM staff`))[0].count,
      2,
    );
  });
});

test("singleton/composite keys, orphan refusal and all three RESTRICT FKs protect parents on delete and update", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await insertCatalog(db);
    await assert.rejects(
      db.execute(
        sql`INSERT INTO business_settings SELECT * FROM business_settings`,
      ),
      violation("23505"),
    );
    await assert.rejects(
      db.execute(sql`INSERT INTO business_settings
      SELECT 2, name, address, time_zone, default_phone_country, currency, lead_time_minutes, horizon_days FROM business_settings`),
      violation("23514", "business_settings_singleton"),
    );
    for (const table of [
      "services",
      "staff",
      "business_hours",
      "staff_services",
    ]) {
      await assert.rejects(
        db.execute(
          sql`INSERT INTO ${sql.identifier(table)} SELECT * FROM ${sql.identifier(table)}`,
        ),
        violation("23505"),
      );
    }
    await assert.rejects(
      db.execute(
        sql`INSERT INTO business_hours VALUES (2, 1, 0, '09:00', '18:00')`,
      ),
      violation("23503"),
    );
    await assert.rejects(
      db.execute(sql`INSERT INTO staff_services VALUES ('missing', 'service')`),
      violation("23503"),
    );
    await assert.rejects(
      db.execute(sql`INSERT INTO staff_services VALUES ('person', 'missing')`),
      violation("23503"),
    );
    // PostgreSQL 18 reports RESTRICT parent mutations as restrict_violation
    // (23001), distinct from orphan inserts' foreign_key_violation (23503).
    const parentConstraints = {
      business_settings: "business_hours_business_id_business_settings_id_fkey",
      services: "staff_services_service_id_services_id_fkey",
      staff: "staff_services_staff_id_staff_id_fkey",
    };
    for (const [table, constraint] of Object.entries(parentConstraints)) {
      await assert.rejects(
        db.execute(sql`DELETE FROM ${sql.identifier(table)}`),
        violation("23001", constraint),
      );
    }
    for (const table of ["services", "staff"] as const) {
      await assert.rejects(
        db.execute(sql`UPDATE ${sql.identifier(table)} SET id = 'changed'`),
        violation("23001", parentConstraints[table]),
      );
    }
    // Singleton prevents changing business id to another valid key. Inspect the
    // actual FK action too, rather than mistaking its CHECK failure for RESTRICT.
    const fks = await rows(
      db,
      sql`SELECT c.confdeltype, c.confupdtype
      FROM pg_catalog.pg_constraint c WHERE c.connamespace = pg_catalog.to_regnamespace(current_schema()) AND c.contype = 'f'`,
    );
    assert.equal(fks.length, 3);
    assert.ok(
      fks.every((fk) => fk.confdeltype === "r" && fk.confupdtype === "r"),
    );
    const targets = await rows(
      db,
      sql`SELECT n.nspname FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class parent ON parent.oid = c.confrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = parent.relnamespace
      WHERE c.connamespace = pg_catalog.to_regnamespace(current_schema()) AND c.contype = 'f'`,
    );
    const schema = (await rows(db, sql`SELECT current_schema() AS name`))[0]
      .name;
    assert.ok(targets.every((row) => row.nspname === schema));
  });
});
