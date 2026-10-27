import assert from "node:assert/strict";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  businessHours,
  businessSettings,
  scheduleExceptions,
  services,
  staff,
  staffOccupancy,
  staffSchedules,
  staffServices,
} from "@/db/schema";
import { seedCatalog } from "@/db/seed";
import { withTestDatabase } from "@/db/testing";
import app from "@/server/app";
import {
  readAvailability,
  validateAvailabilityQuery,
} from "@/server/availability-query";

const NOW = Date.parse("2026-05-31T22:00:00Z"); // Tokyo Monday 07:00
const read = (db: NodePgDatabase, query = QUERY, now = NOW) =>
  readAvailability(
    db,
    validateAvailabilityQuery(new URLSearchParams(query)),
    now,
  );

const QUERY = "staff=mimi&service=cut_w&from=2026-06-01&to=2026-06-01";

async function fixture(db: NodePgDatabase) {
  await seedCatalog(db);
  await db.update(businessSettings).set({ timeZone: "Asia/Tokyo" });
  await db.delete(businessHours);
  await db.insert(businessHours).values({
    businessId: 1,
    weekday: 1,
    windowIndex: 0,
    opensAt: "09:00",
    closesAt: "12:00",
  });
  await db.insert(staffSchedules).values({
    staffId: "mimi",
    weekday: 1,
    windowIndex: 0,
    opensAt: "09:00",
    closesAt: "12:00",
  });
}

async function get(query = QUERY, db?: NodePgDatabase) {
  const response = await app.request(`/api/availability?${query}`, {}, { db });
  assert.equal(response.headers.get("cache-control"), "no-store");
  return { status: response.status, body: await response.json() };
}

test("availability rejects malformed and unbounded requests before database access", async () => {
  const cases: [string, string][] = [
    [`${QUERY}&duration=1`, "invalid_query"],
    [`${QUERY}&now=2000-01-01`, "invalid_query"],
    [`${QUERY}&price=0`, "invalid_query"],
    [`${QUERY}&staff=pavel`, "invalid_staff_id"],
    [QUERY.replace("staff=mimi", "staff="), "invalid_staff_id"],
    [
      QUERY.replace("staff=mimi", `staff=${"x".repeat(65)}`),
      "invalid_staff_id",
    ],
    [QUERY.replace("&service=cut_w", ""), "services_required"],
    [`${QUERY}&service=cut_w`, "duplicate_services"],
    [QUERY.replace("service=cut_w", "service="), "invalid_service_id"],
    [
      QUERY.replace(
        "service=cut_w",
        Array.from({ length: 21 }, (_, i) => `service=s${i}`).join("&"),
      ),
      "too_many_services",
    ],
    [QUERY.replace("from=2026-06-01", "from=2026-02-30"), "invalid_date_range"],
    [QUERY.replaceAll("2026-06-01", "0000-01-01"), "invalid_date_range"],
    [`${QUERY}&from=2026-06-01`, "invalid_date_range"],
    [QUERY.replace("to=2026-06-01", "to=2026-05-31"), "invalid_date_range"],
    [QUERY.replace("to=2026-06-01", "to=2026-06-08"), "date_range_too_large"],
  ];
  for (const [query, code] of cases) {
    const result = await get(query);
    assert.equal(result.status, 400, query);
    assert.equal(result.body.error.code, code, query);
  }
  assert.deepEqual(await get(), {
    status: 500,
    body: { error: { code: "availability_unavailable" } },
  });
});

test("availability returns public calendar metadata and uses the HTTP server clock", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await fixture(db);
    const before = Date.now();
    const result = await get(QUERY, db);
    const after = Date.now();
    assert.equal(result.status, 200);
    assert.deepEqual(Object.keys(result.body).sort(), [
      "days",
      "from",
      "serverNow",
      "timeZone",
      "to",
    ]);
    assert.equal(result.body.timeZone, "Asia/Tokyo");
    assert.ok(
      Date.parse(result.body.serverNow) >= before &&
        Date.parse(result.body.serverNow) <= after,
    );
    // Far-past days stay present but cannot offer slots.
    const past = await get(QUERY.replaceAll("2026-06-01", "2000-01-01"), db);
    assert.deepEqual(past.body.days, [{ date: "2000-01-01", slots: [] }]);
  });
});

test("persisted timing and occupancy determine public slots with touching boundaries", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await fixture(db);
    await db
      .update(services)
      .set({ durationMinutes: 45, cleanupMinutes: 15 })
      .where(eq(services.id, "cut_w"));
    const before = await read(db);
    assert.equal(before.days[0].slots.length, 9);
    assert.deepEqual(before.days[0].slots[0], {
      start: "2026-06-01T00:00:00.000Z",
      end: "2026-06-01T00:45:00.000Z",
    });
    assert.equal(
      before.days[0].slots.at(-1)?.start,
      "2026-06-01T02:00:00.000Z",
    );
    await db.insert(staffOccupancy).values({
      staffId: "mimi",
      kind: "appointment",
      period: "[2026-06-01T01:00:00Z,2026-06-01T02:00:00Z)",
    });
    assert.deepEqual(
      (await read(db)).days[0].slots.map((s) => s.start),
      ["2026-06-01T00:00:00.000Z", "2026-06-01T02:00:00.000Z"],
    );
    // A block starting well BEFORE the query must still hide overlapping slots.
    await db.insert(staffOccupancy).values({
      staffId: "mimi",
      kind: "block",
      period: "[2026-05-01T00:00:00Z,2026-06-01T00:30:00Z)",
    });
    assert.deepEqual(
      (await read(db)).days[0].slots.map((s) => s.start),
      ["2026-06-01T02:00:00.000Z"],
    );
    await db.delete(staffOccupancy);
    await db
      .update(services)
      .set({ durationMinutes: 90, cleanupMinutes: 30 })
      .where(eq(services.id, "cut_w"));
    const longer = (await read(db)).days[0].slots;
    assert.equal(longer.length, 5);
    assert.deepEqual(longer.at(-1), {
      start: "2026-06-01T01:00:00.000Z",
      end: "2026-06-01T02:30:00.000Z",
    });
  });
});

test("new requests observe staff schedules and business/staff dated overrides", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await fixture(db);
    assert.ok((await read(db)).days[0].slots.length > 0);
    await db.update(staffSchedules).set({ opensAt: "11:00" });
    assert.equal(
      (await read(db)).days[0].slots[0].start,
      "2026-06-01T02:00:00.000Z",
    );
    await db.insert(scheduleExceptions).values({
      staffId: "mimi",
      onDate: "2026-06-01",
      windowIndex: 0,
      isClosed: false,
      opensAt: "10:00",
      closesAt: "11:00",
    });
    assert.equal(
      (await read(db)).days[0].slots[0].start,
      "2026-06-01T01:00:00.000Z",
    );
    await db.insert(scheduleExceptions).values({
      businessId: 1,
      onDate: "2026-06-01",
      windowIndex: 0,
      isClosed: true,
    });
    assert.deepEqual((await read(db)).days, [
      { date: "2026-06-01", slots: [] },
    ]);
  });
});

test("all selected persisted competencies are required and inactive records are rejected", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await fixture(db);
    const multiple = `${QUERY}&service=cut_m`;
    await db
      .update(services)
      .set({ durationMinutes: 30, cleanupMinutes: 15 })
      .where(sql`${services.id} in ('cut_w', 'cut_m')`);
    const combined = (await read(db, multiple)).days[0].slots;
    assert.equal(combined.length, 7); // 60 minutes service + 30 trailing cleanup
    assert.deepEqual(combined.at(-1), {
      start: "2026-06-01T01:30:00.000Z",
      end: "2026-06-01T02:30:00.000Z",
    });
    await db.delete(staffServices).where(eq(staffServices.serviceId, "cut_m"));
    assert.deepEqual((await read(db, multiple)).days[0].slots, []);
    assert.ok((await read(db)).days[0].slots.length > 0);
    await db
      .update(services)
      .set({ isActive: false })
      .where(eq(services.id, "cut_w"));
    assert.deepEqual(await get(QUERY, db), {
      status: 400,
      body: { error: { code: "unknown_services", serviceIds: ["cut_w"] } },
    });
    await db
      .update(services)
      .set({ isActive: true })
      .where(eq(services.id, "cut_w"));
    await db.update(staff).set({ isActive: false }).where(eq(staff.id, "mimi"));
    assert.deepEqual(await get(QUERY, db), {
      status: 400,
      body: { error: { code: "unknown_staff" } },
    });
    assert.equal(
      (await get(QUERY.replace("staff=mimi", "staff=missing"), db)).body.error
        .code,
      "unknown_staff",
    );
    assert.equal(
      (await get(QUERY.replace("service=cut_w", "service=missing"), db)).body
        .error.code,
      "unknown_services",
    );
  });
});

test("configured lead and horizon bound slots, not calendar response shape", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await fixture(db);
    const range = QUERY.replace("to=2026-06-01", "to=2026-06-07");
    const week = await read(db, range);
    assert.equal(week.days.length, 7);
    assert.equal(week.days.at(-1)?.date, "2026-06-07");
    assert.deepEqual(week.days[1].slots, []);
    const boundaryNow = Date.parse("2026-05-31T23:00:00Z"); // 08:00 Tokyo + 1h = opens
    assert.equal(
      (await read(db, QUERY, boundaryNow)).days[0].slots[0].start,
      "2026-06-01T00:00:00.000Z",
    );
    assert.equal(
      (await read(db, QUERY, boundaryNow + 1)).days[0].slots[0].start,
      "2026-06-01T00:15:00.000Z",
    );
    await db.update(businessSettings).set({ leadTimeMinutes: 240 });
    assert.equal(
      (await read(db)).days[0].slots[0].start,
      "2026-06-01T02:00:00.000Z",
    );
    await db
      .update(businessSettings)
      .set({ leadTimeMinutes: 60, horizonDays: 1 });
    const sundayNow = Date.parse("2026-05-30T22:00:00Z");
    assert.ok((await read(db, QUERY, sundayNow)).days[0].slots.length > 0);
    await db.update(businessSettings).set({ horizonDays: 0 });
    assert.deepEqual((await read(db, QUERY, sundayNow)).days[0].slots, []);
  });
});

test("supported extreme dates outside the configured horizon stay empty", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await fixture(db);
    for (const date of ["0001-01-01", "9999-12-31"]) {
      const result = await get(QUERY.replaceAll("2026-06-01", date), db);
      assert.equal(result.status, 200);
      assert.equal(result.body.from, date);
      assert.equal(result.body.to, date);
      assert.deepEqual(result.body.days, [{ date, slots: [] }]);
    }
  });
});

test("database-backed DST availability excludes ambiguous starts and serializes UTC slots", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await fixture(db);
    await db.update(businessSettings).set({ timeZone: "America/New_York" });
    await db
      .update(services)
      .set({ durationMinutes: 30, cleanupMinutes: 0 })
      .where(eq(services.id, "cut_w"));
    await db
      .update(businessHours)
      .set({ weekday: 0, opensAt: "00:00", closesAt: "04:00" });
    await db
      .update(staffSchedules)
      .set({ weekday: 0, opensAt: "00:00", closesAt: "04:00" });
    const query = QUERY.replaceAll("2026-06-01", "2026-11-01");
    const now = Date.parse("2026-10-31T04:00:00Z");
    const free = (await read(db, query, now)).days[0].slots;
    assert.equal(free.length, 11);
    assert.ok(
      free.every(
        (slot) =>
          !slot.start.startsWith("2026-11-01T05:") &&
          !slot.start.startsWith("2026-11-01T06:"),
      ),
    );
    await db.insert(staffOccupancy).values({
      staffId: "mimi",
      kind: "block",
      period: "[2026-10-31T00:00:00Z,2026-11-01T07:00:00Z)",
    });
    const remaining = (await read(db, query, now)).days[0].slots;
    assert.equal(remaining.length, 7);
    assert.deepEqual(remaining[0], {
      start: "2026-11-01T07:00:00.000Z",
      end: "2026-11-01T07:30:00.000Z",
    });
    assert.equal(remaining.at(-1)?.end, "2026-11-01T09:00:00.000Z");
  });
});

test("missing settings and database failures return stable sanitized errors", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await fixture(db);
    await db.execute(
      sql`alter table staff_schedules rename to unavailable_schedules`,
    );
    assert.deepEqual(await get(QUERY, db), {
      status: 500,
      body: { error: { code: "internal" } },
    });
    await db.delete(businessHours);
    await db.delete(businessSettings);
    assert.deepEqual(await get(QUERY, db), {
      status: 500,
      body: { error: { code: "availability_unavailable" } },
    });
  });
});
