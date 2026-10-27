import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { createDemoSalon } from "@/app/_lib/booking/fixtures";
import {
  businessHours,
  businessSettings,
  services,
  staff,
  staffServices,
} from "@/db/schema";
import { seedCatalog, validateNamedTimeZone } from "@/db/seed";
import { withTestDatabase } from "@/db/testing";

const demo = createDemoSalon(() => Date.UTC(2026, 9, 26, 12));
const serviceIds = demo.services.map(({ id }) => id);
const staffIds = demo.staff.map(({ id }) => id);
async function snapshot(db: NodePgDatabase) {
  return [
    await db.select().from(businessSettings),
    await db
      .select()
      .from(businessHours)
      .orderBy(businessHours.weekday, businessHours.windowIndex),
    await db.select().from(services).orderBy(services.sortOrder),
    await db.select().from(staff).orderBy(staff.sortOrder),
    await db
      .select()
      .from(staffServices)
      .orderBy(staffServices.staffId, staffServices.serviceId),
  ] as const;
}

test("named IANA boundary accepts named zones, rejects offset-only and invalid identifiers", () => {
  for (const zone of ["Europe/Sofia", "America/New_York", "Etc/GMT+2", "UTC"])
    assert.doesNotThrow(() => validateNamedTimeZone(zone));
  for (const zone of [
    "+02:00",
    "-0200",
    "+02",
    "02:00",
    "",
    " Europe/Sofia",
    "Invalid/Zone",
  ])
    assert.throws(
      () => validateNamedTimeZone(zone),
      /Invalid catalog time zone/,
    );
});

test("private committed migrations and seed twice preserve the exact static projection, NULL/EUR, keys and physical no-op", async () => {
  await withTestDatabase({}, async ({ db, independentDb, migrate }) => {
    await migrate();
    await seedCatalog(db);
    const actual = await snapshot(db);
    assert.deepEqual(actual[0], [
      {
        id: 1,
        name: demo.name,
        address: demo.address,
        timeZone: "Europe/Sofia",
        defaultPhoneCountry: "BG",
        currency: "EUR",
        leadTimeMinutes: 60,
        horizonDays: 60,
      },
    ]);
    assert.deepEqual(
      actual[1],
      Array.from({ length: 6 }, (_, i) => ({
        businessId: 1,
        weekday: i + 1,
        windowIndex: 0,
        opensAt: i === 5 ? "10:00:00" : "09:00:00",
        closesAt: i === 5 ? "16:00:00" : "18:00:00",
      })),
    );
    assert.deepEqual(
      actual[2],
      demo.services.map((service, sortOrder) => ({
        ...service,
        currency: "EUR",
        isActive: true,
        sortOrder,
      })),
    );
    assert.deepEqual(
      actual[3],
      demo.staff.map(({ id, name, description, imageUrl }, sortOrder) => ({
        id,
        name,
        description,
        imageUrl,
        isActive: true,
        sortOrder,
      })),
    );
    const pairs = demo.staff
      .flatMap(({ id, serviceIds }) =>
        serviceIds.map((serviceId) => ({ staffId: id, serviceId })),
      )
      .sort(
        (a, b) =>
          a.staffId.localeCompare(b.staffId) ||
          a.serviceId.localeCompare(b.serviceId),
      );
    assert.deepEqual(actual[4], pairs);
    assert.deepEqual(
      actual.map((rows) => rows.length),
      [1, 6, 12, 3, 19],
    );
    const physical = await db.execute(
      sql`SELECT id, xmin::text, ctid::text FROM services ORDER BY id`,
      "objects",
    );
    await seedCatalog(independentDb);
    assert.deepEqual(await snapshot(db), actual);
    assert.deepEqual(
      await db.execute(
        sql`SELECT id, xmin::text, ctid::text FROM services ORDER BY id`,
        "objects",
      ),
      physical,
    );
    assert.deepEqual(
      actual[2].map(({ id }) => id),
      serviceIds,
    );
    assert.deepEqual(
      actual[3].map(({ id }) => id),
      staffIds,
    );
  });
});

test("two held sessions serialize concurrent first initialization and canonical reruns", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const sessions = await Promise.all([
      db.execute(sql`SELECT pg_backend_pid() AS pid`, "objects"),
      independentDb.execute(sql`SELECT pg_backend_pid() AS pid`, "objects"),
    ]);
    assert.notEqual(sessions[0][0].pid, sessions[1][0].pid);
    await Promise.all([seedCatalog(db), seedCatalog(independentDb)]);
    const before = await snapshot(db);
    await Promise.all([seedCatalog(db), seedCatalog(independentDb)]);
    assert.deepEqual(await snapshot(db), before);
    assert.deepEqual(
      before.map((rows) => rows.length),
      [1, 6, 12, 3, 19],
    );
  });
});

test("seed waits for the transaction-scoped advisory lock on the other held session", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const [session] = await independentDb.execute(
      sql`SELECT pg_backend_pid() AS pid`,
      "objects",
    );
    let pending: Promise<void> | undefined;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(583104, 58)`);
        pending = seedCatalog(independentDb);
        // Attach immediately: the deliberately broken-lock mutation must not
        // produce an unhandled rejection while this session inspects pg_locks.
        void pending.catch(() => {});
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          const [lock] = await tx.execute(
            sql`SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_locks
            WHERE pid = ${session.pid} AND locktype = 'advisory' AND NOT granted) AS waiting`,
            "objects",
          );
          waiting = lock.waiting === true;
          if (!waiting) await tx.execute(sql`SELECT pg_sleep(0.01)`);
        }
        assert.equal(
          waiting,
          true,
          "second session must block on the seed lock",
        );
        assert.equal((await tx.select().from(businessSettings)).length, 0);
      });
    } finally {
      // The first session has committed/rolled back, releasing its xact lock.
      await pending;
    }
    assert.deepEqual(
      (await snapshot(db)).map((rows) => rows.length),
      [1, 6, 12, 3, 19],
    );
  });
});

async function qualified(db: NodePgDatabase, selected: string[]) {
  return db.execute(
    sql`SELECT s.id FROM staff s WHERE s.is_active
    AND NOT EXISTS (SELECT 1 FROM unnest(${sql.param(selected)}::text[]) wanted(id)
      WHERE NOT EXISTS (SELECT 1 FROM services v JOIN staff_services c ON c.service_id = v.id
        WHERE v.id = wanted.id AND v.is_active AND c.staff_id = s.id)) ORDER BY s.id`,
    "objects",
  );
}

test("active ALL-services eligibility: hair, massage, mixed, duplicates and inactive entities", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await seedCatalog(db);
    const hair = demo.services
      .filter((s) => s.category === "Коса")
      .map((s) => s.id);
    const massage = demo.services
      .filter((s) => s.category === "Масажи")
      .map((s) => s.id);
    assert.deepEqual(await qualified(db, hair), [
      { id: "mimi" },
      { id: "pavel" },
    ]);
    assert.deepEqual(await qualified(db, massage), [{ id: "emil" }]);
    assert.deepEqual(await qualified(db, [...hair, ...massage]), []);
    assert.deepEqual(await qualified(db, ["keratin", "keratin"]), [
      { id: "mimi" },
      { id: "pavel" },
    ]);
    await db.execute(sql`UPDATE staff SET is_active = false WHERE id = 'mimi'`);
    assert.deepEqual(await qualified(db, hair), [{ id: "pavel" }]);
    await db.execute(
      sql`UPDATE services SET is_active = false WHERE id = 'keratin'`,
    );
    assert.deepEqual(await qualified(db, hair), []);
    assert.deepEqual(await qualified(db, massage), [{ id: "emil" }]);
    await assert.rejects(seedCatalog(db), /Catalog fixture drift/);
  });
});

const driftCases = [
  sql`UPDATE services SET price_cents = 0 WHERE id = 'keratin'`,
  sql`UPDATE services SET currency = 'USD' WHERE id = 'cut_w'`,
  sql`UPDATE services SET is_active = false WHERE id = 'cut_w'`,
  sql`UPDATE staff SET is_active = false WHERE id = 'mimi'`,
  sql`UPDATE staff SET description = 'changed' WHERE id = 'pavel'`,
  sql`UPDATE business_settings SET horizon_days = 61`,
  sql`UPDATE business_hours SET opens_at = '08:00' WHERE weekday = 1`,
  sql`DELETE FROM business_hours WHERE weekday = 1`,
  sql`INSERT INTO business_hours VALUES (1, 0, 0, '10:00', '11:00')`,
  sql`INSERT INTO business_hours VALUES (1, 1, 1, '19:00', '20:00')`,
  sql`DELETE FROM staff_services WHERE staff_id = 'mimi' AND service_id = 'keratin'`,
  sql`INSERT INTO staff_services VALUES ('mimi', 'massage_relax')`,
];
for (const [index, drift] of driftCases.entries()) {
  test(`fixture drift ${index + 1} refuses atomically without repair`, async () => {
    await withTestDatabase({}, async ({ db }) => {
      await seedCatalog(db);
      await db.execute(drift);
      const before = await snapshot(db);
      await assert.rejects(seedCatalog(db), /Catalog fixture drift/);
      assert.deepEqual(await snapshot(db), before);
    });
  });
}

test("partial reserved graph refuses instead of adopting/filling holes", async () => {
  for (const partial of [
    sql`INSERT INTO staff (id, name, description, sort_order) VALUES ('mimi', 'partial', 'partial', 0)`,
    sql`INSERT INTO services (id, name, category, currency, duration_minutes, cleanup_minutes, sort_order) VALUES ('keratin', 'partial', 'partial', 'EUR', 90, 15, 4)`,
    sql`INSERT INTO business_settings VALUES (1, 'partial', 'partial', 'Europe/Sofia', 'BG', 'EUR', 60, 60)`,
  ]) {
    await withTestDatabase({}, async ({ db }) => {
      await db.execute(partial);
      const before = await snapshot(db);
      await assert.rejects(seedCatalog(db), /Catalog fixture drift/);
      assert.deepEqual(await snapshot(db), before);
    });
  }
});

test("first initialization rolls back every insertion on late failure", async () => {
  await withTestDatabase({}, async ({ db }) => {
    // A disposable-only constraint forces failure at the LAST graph insertion.
    await db.execute(
      sql`ALTER TABLE staff_services ADD CONSTRAINT synthetic_failure CHECK (staff_id <> 'emil')`,
    );
    await assert.rejects(seedCatalog(db));
    assert.deepEqual(
      (await snapshot(db)).map((rows) => rows.length),
      [0, 0, 0, 0, 0],
    );
  });
});

test("unrelated rows and synthetic booking-linked future sentinel survive; extra fixture-staff link refuses", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await db.execute(
      sql`INSERT INTO services (id, name, category, currency, duration_minutes, cleanup_minutes, sort_order) VALUES ('extra', 'unrelated', 'other', 'USD', 1, 0, 99)`,
    );
    await db.execute(
      sql`INSERT INTO staff (id, name, description, sort_order) VALUES ('extra', 'unrelated', 'unrelated', 99)`,
    );
    await db.execute(sql`INSERT INTO staff_services VALUES ('extra', 'extra')`);
    await db.execute(
      sql`INSERT INTO scaffold_checks (label) VALUES ('unrelated scaffold')`,
    );
    const before = await snapshot(db);
    await seedCatalog(db);
    await db.execute(sql`INSERT INTO staff_services VALUES ('extra', 'cut_w')`);
    // This is NOT the future appointment schema or actual snapshot protection.
    await db.execute(
      sql`CREATE TABLE synthetic_booking_sentinel (id text PRIMARY KEY, staff_id text REFERENCES staff(id) ON DELETE RESTRICT, service_id text REFERENCES services(id) ON DELETE RESTRICT, starts_at timestamptz, snapshot jsonb)`,
    );
    await db.execute(
      sql`INSERT INTO synthetic_booking_sentinel VALUES ('future', 'mimi', 'keratin', '2099-01-01T10:00:00Z', '{"price":null,"currency":"EUR","label":"fictional"}')`,
    );
    const sentinel = await db.execute(
      sql`SELECT * FROM synthetic_booking_sentinel`,
      "objects",
    );
    const all = await snapshot(db);
    await seedCatalog(db);
    assert.deepEqual(await snapshot(db), all);
    assert.deepEqual(
      all[2].filter((s) => s.id === "extra"),
      before[2],
    );
    assert.deepEqual(
      all[3].filter((s) => s.id === "extra"),
      before[3],
    );
    await db.execute(sql`INSERT INTO staff_services VALUES ('mimi', 'extra')`);
    const drifted = await snapshot(db);
    await assert.rejects(seedCatalog(db), /Catalog fixture drift/);
    assert.deepEqual(await snapshot(db), drifted);
    assert.deepEqual(
      await db.execute(
        sql`SELECT * FROM synthetic_booking_sentinel`,
        "objects",
      ),
      sentinel,
    );
    assert.deepEqual(
      await db.execute(sql`SELECT label FROM scaffold_checks`, "objects"),
      [{ label: "unrelated scaffold" }],
    );
  });
});

function cliChild(url: string, body = "", args: string[] = []) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import pg from 'pg';
    import net from 'node:net';
    net.Socket.prototype.connect = () => { throw new Error('Network forbidden fictional-secret'); };
    ${body}
    process.argv = ['node', 'scripts/db-seed.ts', ...${JSON.stringify(args)}];
    await import('./scripts/db-seed.ts');
  `,
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        TEST_DATABASE_URL: "must-not-fallback",
      },
      encoding: "utf8",
      timeout: 15000,
    },
  );
}

test("app-only CLI refuses inherited invalid/test targets and flags, quietly redacts errors", () => {
  for (const url of [
    "",
    "fictional-secret",
    "postgresql://slotwell_test:fictional-secret@127.0.0.1:55432/slotwell_test",
    "postgresql://slotwell_app:fictional-secret@127.0.0.1:55432/arbitrary",
  ]) {
    const child = cliChild(
      url,
      `pg.Pool = class { constructor() { throw new Error('Pool must not be created'); } };`,
    );
    assert.equal(child.status, 1);
    assert.equal(child.stdout, "");
    assert.equal(child.stderr, "Catalog seed failed\n");
  }
  const child = cliChild(
    "postgresql://slotwell_app:fictional-secret@127.0.0.1:55432/slotwell_dev",
    "",
    ["--reset"],
  );
  assert.equal(child.status, 1);
  assert.equal(child.stderr, "Catalog seed failed\n");
});

test("CLI awaits owned pool close after query failure; close failure is redacted", () => {
  for (const [closeFails, idleError] of [
    [false, false],
    [true, false],
    [false, true],
  ]) {
    const child = cliChild(
      "postgresql://slotwell_app:fictional-secret@127.0.0.1:55432/slotwell_dev",
      `
      let closed = false;
      pg.Pool = class {
        on(event, listener) { if (${idleError}) listener(new Error('fictional-secret idle')); }
        async connect() { throw new Error('fictional-secret SQL private'); }
        async end() {
          await new Promise(resolve => setTimeout(resolve, 25));
          closed = true;
          if (${closeFails}) throw new Error('fictional-secret close');
        }
      };
      process.on('beforeExit', () => assert.equal(closed, true));
    `,
    );
    assert.equal(child.status, 1);
    assert.equal(child.stdout, "");
    assert.equal(
      child.stderr,
      `${idleError ? "database_pool_idle_error\n" : ""}Catalog seed failed\n`,
    );
  }
});
