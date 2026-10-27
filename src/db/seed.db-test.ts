import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { createDemoSalon } from "@/app/_lib/booking/fixtures";
import {
  businessHours,
  businessSettings,
  scheduleExceptions,
  services,
  staff,
  staffSchedules,
  staffServices,
} from "@/db/schema";
import { seedCatalog, seedSchedules, validateNamedTimeZone } from "@/db/seed";
import { withTestDatabase } from "@/db/testing";
import {
  addCalendarDays,
  businessDate,
  resolveLocalStart,
  toUtcIso,
} from "@/server/booking-time";

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

async function rows(db: NodePgDatabase, query: ReturnType<typeof sql>) {
  return db.execute(query, "objects");
}
// Occupancy periods compared by epoch milliseconds of each half-open bound.
async function occupancyRows(db: NodePgDatabase) {
  return rows(
    db,
    sql`SELECT staff_id,
      (EXTRACT(EPOCH FROM lower(period)) * 1000)::bigint AS lower_ms,
      (EXTRACT(EPOCH FROM upper(period)) * 1000)::bigint AS upper_ms,
      kind
      FROM staff_occupancy ORDER BY staff_id, lower(period)`,
  );
}
const scheduleAnchor = Date.UTC(2026, 10, 2, 9, 0); // 2026-11-02T09:00:00Z
const scheduleZone = "Europe/Sofia";
function expectedBlock(
  today: string,
  dayOffset: number,
  startMin: number,
  endMin: number,
) {
  const date = addCalendarDays(today, dayOffset);
  const start = resolveLocalStart(date, startMin, scheduleZone);
  const end = resolveLocalStart(date, endMin, scheduleZone);
  assert.ok(start.kind === "ok" && end.kind === "ok");
  return { lower: start.instant, upper: end.instant };
}

test("seedSchedules projects static weekly schedules and anchored rolling exceptions/blocks", async () => {
  await withTestDatabase({}, async ({ db, migrate }) => {
    await migrate();
    await seedCatalog(db);
    await seedSchedules(db, { anchor: scheduleAnchor });
    const today = businessDate(scheduleAnchor, scheduleZone);

    const schedules = await db
      .select()
      .from(staffSchedules)
      .orderBy(staffSchedules.staffId, staffSchedules.weekday);
    const expectedSchedules = Object.entries({
      emil: [2, 3, 4, 5, 6],
      mimi: [1, 2, 4, 5, 6],
      pavel: [1, 2, 3, 4, 5],
    }).flatMap(([staffId, days]) =>
      days.map((weekday) => ({
        staffId,
        weekday,
        windowIndex: 0,
        opensAt: weekday === 6 ? "10:00:00" : "09:00:00",
        closesAt: weekday === 6 ? "16:00:00" : "18:00:00",
      })),
    );
    assert.deepEqual(schedules, expectedSchedules);

    const exceptions = await db
      .select()
      .from(scheduleExceptions)
      .orderBy(scheduleExceptions.onDate);
    assert.deepEqual(
      exceptions.map((e) => ({
        businessId: e.businessId,
        staffId: e.staffId,
        onDate: e.onDate,
        isClosed: e.isClosed,
        opensAt: e.opensAt,
        closesAt: e.closesAt,
      })),
      [
        {
          businessId: null,
          staffId: "mimi",
          onDate: addCalendarDays(today, 3),
          isClosed: false,
          opensAt: "12:00:00",
          closesAt: "16:00:00",
        },
        {
          businessId: null,
          staffId: "emil",
          onDate: addCalendarDays(today, 5),
          isClosed: true,
          opensAt: null,
          closesAt: null,
        },
        {
          businessId: 1,
          staffId: null,
          onDate: addCalendarDays(today, 10),
          isClosed: true,
          opensAt: null,
          closesAt: null,
        },
      ],
    );

    const blocks = await occupancyRows(db);
    const emil = expectedBlock(today, 1, 13 * 60, 14 * 60);
    const pavel = expectedBlock(today, 2, 15 * 60, 16 * 60 + 30);
    assert.deepEqual(
      blocks.map((b) => ({
        staffId: b.staff_id,
        lower: Number(b.lower_ms),
        upper: Number(b.upper_ms),
        kind: b.kind,
      })),
      [
        {
          staffId: "emil",
          lower: emil.lower,
          upper: emil.upper,
          kind: "block",
        },
        {
          staffId: "pavel",
          lower: pavel.lower,
          upper: pavel.upper,
          kind: "block",
        },
      ],
    );
  });
});

test("seedSchedules is idempotent: a second run with the same anchor is a physical no-op", async () => {
  await withTestDatabase({}, async ({ db, migrate }) => {
    await migrate();
    await seedCatalog(db);
    await seedSchedules(db, { anchor: scheduleAnchor });
    const counts = async () => ({
      schedules: (
        await rows(db, sql`SELECT count(*)::int AS c FROM staff_schedules`)
      )[0].c,
      exceptions: (
        await rows(db, sql`SELECT count(*)::int AS c FROM schedule_exceptions`)
      )[0].c,
      blocks: (
        await rows(db, sql`SELECT count(*)::int AS c FROM staff_occupancy`)
      )[0].c,
    });
    const before = await counts();
    assert.deepEqual(before, { schedules: 15, exceptions: 3, blocks: 2 });
    // A second identical run must not duplicate rows or trip the overlap guard.
    await seedSchedules(db, { anchor: scheduleAnchor });
    assert.deepEqual(await counts(), before);
  });
});

test("seedSchedules preserves appointments and advances rolling fixtures without deleting", async () => {
  await withTestDatabase({}, async ({ db, migrate }) => {
    await migrate();
    await seedCatalog(db);
    await seedSchedules(db, { anchor: scheduleAnchor });
    const laterAnchor = scheduleAnchor + 30 * 86_400_000;
    const laterToday = businessDate(laterAnchor, scheduleZone);

    // A real appointment that overlaps the later run's emil block.
    const emilDate = addCalendarDays(laterToday, 1);
    const apptStart = resolveLocalStart(emilDate, 13 * 60 + 30, scheduleZone);
    // massage_relax: 75 service minutes + 15 cleanup minutes.
    const apptEnd = resolveLocalStart(emilDate, 15 * 60, scheduleZone);
    assert.ok(apptStart.kind === "ok" && apptEnd.kind === "ok");
    const clientId = "00000000-0000-4000-8000-000000000087";
    const appointmentId = "00000000-0000-4000-8000-000000000088";
    const serviceEnd = toUtcIso(apptStart.instant + 75 * 60_000);
    await db.execute(
      sql`INSERT INTO clients VALUES (${clientId}, '+359888123456')`,
    );
    await db.execute(sql`INSERT INTO appointments
      (id, client_id, staff_id, contact_name, contact_phone, contact_email, staff_name,
       business_address, booking_time_zone, starts_at, service_ends_at, occupied_ends_at, created_at, confirmation_expires_at)
      SELECT ${appointmentId}, ${clientId}, s.id, 'Fictional guest', '+359888123456', 'guest@example.test', s.name,
        b.address, b.time_zone, ${toUtcIso(apptStart.instant)}, ${serviceEnd}, ${toUtcIso(apptEnd.instant)},
        ${toUtcIso(scheduleAnchor)}, ${serviceEnd}::timestamptz + INTERVAL '168 hours'
      FROM staff s CROSS JOIN business_settings b WHERE s.id = 'emil'`);
    await db.execute(sql`INSERT INTO appointment_services
      (appointment_id, position, service_id, name, price_cents, currency, duration_minutes, cleanup_minutes)
      SELECT ${appointmentId}, 0, id, name, price_cents, currency, duration_minutes, cleanup_minutes FROM services WHERE id = 'massage_relax'`);
    await db.execute(
      sql`INSERT INTO staff_occupancy (staff_id, period, kind, appointment_id) VALUES ('emil', tstzrange(${toUtcIso(apptStart.instant)}::timestamptz, ${toUtcIso(apptEnd.instant)}::timestamptz, '[)'), 'appointment', ${appointmentId})`,
    );
    const agreement = await rows(
      db,
      sql`SELECT * FROM appointments WHERE id = ${appointmentId}`,
    );
    const bookedServices = await rows(
      db,
      sql`SELECT * FROM appointment_services WHERE appointment_id = ${appointmentId}`,
    );

    const beforeBlocks = (await occupancyRows(db)).filter(
      (r) => r.kind === "block",
    ).length;
    await seedSchedules(db, { anchor: laterAnchor });

    const all = await occupancyRows(db);
    // The appointment and its immutable agreement survive the reseed untouched.
    assert.equal(all.filter((r) => r.kind === "appointment").length, 1);
    assert.deepEqual(
      await rows(
        db,
        sql`SELECT * FROM appointments WHERE id = ${appointmentId}`,
      ),
      agreement,
    );
    assert.deepEqual(
      await rows(
        db,
        sql`SELECT * FROM appointment_services WHERE appointment_id = ${appointmentId}`,
      ),
      bookedServices,
    );
    // The later pavel block is added; the later emil block is skipped (overlaps
    // the appointment); earlier blocks remain (non-destructive).
    const blocks = all.filter((r) => r.kind === "block");
    assert.equal(blocks.length, beforeBlocks + 1);
    const emilBlockStart = resolveLocalStart(emilDate, 13 * 60, scheduleZone);
    assert.ok(emilBlockStart.kind === "ok");
    assert.equal(
      blocks.find(
        (b) =>
          b.staff_id === "emil" &&
          Number(b.lower_ms) === emilBlockStart.instant,
      ),
      undefined,
    );
  });
});

test("seedSchedules requires a seeded catalog and a valid anchor", async () => {
  await withTestDatabase({}, async ({ db, migrate }) => {
    await migrate();
    await assert.rejects(
      seedSchedules(db, { anchor: scheduleAnchor }),
      /Catalog must be seeded before schedules/,
    );
    await seedCatalog(db);
    for (const anchor of [1.5, Number.NaN, 2 ** 60]) {
      await assert.rejects(
        seedSchedules(db, { anchor }),
        /Invalid seed anchor/,
      );
    }
  });
});
