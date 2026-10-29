import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  appointmentAccess,
  appointmentServices,
  appointments,
  bookingOperations,
  businessHours,
  businessSettings,
  clients,
  scheduleExceptions,
  services,
  staff,
  staffOccupancy,
  staffSchedules,
  staffServices,
} from "@/db/schema";
import { seedCatalog } from "@/db/seed";
import { withTestDatabase } from "@/db/testing";
import {
  BookingError,
  type BookingInput,
  type BookingRecovery,
  bookAppointment,
} from "@/server/booking/book-appointment";

const isCode = (code: string) => (error: unknown) =>
  error instanceof BookingError && error.code === code;

const NOW = Date.parse("2026-05-31T22:00:00Z"); // Tokyo Monday 07:00
async function fixture(db: NodePgDatabase): Promise<BookingInput> {
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
  await db
    .update(services)
    .set({ durationMinutes: 30, cleanupMinutes: 15 })
    .where(eq(services.id, "cut_w"));
  const [service] = await db
    .select()
    .from(services)
    .where(eq(services.id, "cut_w"));
  return {
    staffId: "mimi",
    serviceIds: ["cut_w"],
    startsAt: "2026-06-01T09:00:00+09:00",
    reviewedServices: [service],
    contact: {
      name: "  Guest One  ",
      phone: "0888 123 456",
      email: "guest@example.test",
      note: "Private note",
    },
  };
}
async function intent(db: NodePgDatabase): Promise<BookingRecovery> {
  const operationId = randomUUID();
  const credentialHash = operationId.replaceAll("-", "").repeat(2);
  await db.insert(bookingOperations).values({
    id: operationId,
    credentialHash,
    state: "pending",
    createdAt: new Date(NOW - 1000).toISOString(),
    submitBefore: new Date(NOW + 86_400_000).toISOString(),
  });
  return {
    operationId,
    credentialHash,
    prepare: () => ({
      tokenHash: credentialHash,
      payloadFingerprint: "a".repeat(64),
      fingerprintVersion: 1,
      fingerprintKeyId: "test-hmac",
      encryptedReplay: "ab".repeat(60),
      replayKeyId: "test-replay",
    }),
  };
}

test("booking atomically stores authoritative snapshots, occupancy, access and committed intent", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    const recovery = await intent(db);
    const result = await bookAppointment(db, input, recovery, () => NOW);
    assert.equal(result.kind, "created");
    const [appointment] = await db.select().from(appointments);
    assert.equal(appointment.contactName, "Guest One");
    assert.equal(appointment.contactPhone, "0888 123 456");
    assert.equal(appointment.contactEmail, "guest@example.test");
    assert.equal(appointment.notes, "Private note");
    assert.equal(appointment.status, "confirmed");
    assert.equal(appointment.bookingTimeZone, "Asia/Tokyo");
    assert.equal(Date.parse(appointment.startsAt), Date.parse(input.startsAt));
    assert.equal(
      Date.parse(appointment.serviceEndsAt),
      Date.parse(input.startsAt) + 30 * 60_000,
    );
    assert.equal(
      Date.parse(appointment.occupiedEndsAt),
      Date.parse(input.startsAt) + 45 * 60_000,
    );
    assert.equal(
      Date.parse(appointment.confirmationExpiresAt),
      Date.parse(appointment.serviceEndsAt) + 168 * 3_600_000,
    );
    const [client] = await db.select().from(clients);
    assert.equal(client.normalizedPhone, "+359888123456");
    assert.equal(client.id, appointment.clientId);
    const [snapshot] = await db.select().from(appointmentServices);
    assert.equal(snapshot.position, 0);
    assert.equal(snapshot.durationMinutes, 30);
    assert.equal(snapshot.cleanupMinutes, 15);
    assert.equal(snapshot.name, input.reviewedServices[0].name);
    const [occupied] = await db
      .select({
        staffId: staffOccupancy.staffId,
        appointmentId: staffOccupancy.appointmentId,
        start:
          sql`extract(epoch from lower(${staffOccupancy.period})) * 1000`.mapWith(
            Number,
          ),
        end: sql`extract(epoch from upper(${staffOccupancy.period})) * 1000`.mapWith(
          Number,
        ),
      })
      .from(staffOccupancy);
    assert.equal(occupied.appointmentId, appointment.id);
    assert.equal(occupied.staffId, appointment.staffId);
    assert.equal(occupied.start, Date.parse(appointment.startsAt));
    assert.equal(occupied.end, Date.parse(appointment.occupiedEndsAt));
    assert.equal((await db.select().from(appointmentAccess)).length, 1);
    const [operation] = await db.select().from(bookingOperations);
    assert.equal(operation.state, "committed");
    if (result.kind === "created") {
      assert.equal(result.durationMinutes, 30);
      assert.equal(result.cleanupMinutes, 15);
      assert.equal(
        result.totalPriceCents,
        input.reviewedServices[0].priceCents,
      );
    }
    assert.equal(operation.appointmentId, appointment.id);
    assert.equal(
      Date.parse(operation.replayExpiresAt ?? ""),
      Date.parse(appointment.confirmationExpiresAt),
    );
  });
});

async function assertEmptyBooking(db: NodePgDatabase) {
  for (const table of [
    appointments,
    appointmentServices,
    clients,
    staffOccupancy,
    appointmentAccess,
  ]) {
    assert.equal((await db.select().from(table)).length, 0);
  }
  assert.ok(
    (await db.select().from(bookingOperations)).every(
      (row) => row.state === "pending",
    ),
  );
}

test("stale reviewed values and invalid contacts never create a partial booking", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    const recovery = await intent(db);
    for (const patch of [
      { name: "Old name" },
      { priceCents: 1 },
      { priceCents: null },
      { currency: "BGN" },
      { durationMinutes: 1 },
      { cleanupMinutes: 0 },
    ]) {
      await assert.rejects(
        bookAppointment(
          db,
          {
            ...input,
            reviewedServices: [{ ...input.reviewedServices[0], ...patch }],
          },
          recovery,
          () => NOW,
        ),
        isCode("review_required"),
      );
      await assertEmptyBooking(db);
    }
    await assert.rejects(
      bookAppointment(
        db,
        { ...input, contact: { name: "Guest", phone: "not a phone" } },
        recovery,
        () => NOW,
      ),
      isCode("invalid_contact"),
    );
    await assertEmptyBooking(db);
    const [catalog] = await db
      .select()
      .from(services)
      .where(eq(services.id, "cut_w"));
    assert.deepEqual(catalog, input.reviewedServices[0]);
  });
});

test("unavailable starts roll back even the newly matched client; committed intent dispatch never books twice", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    const recovery = await intent(db);
    await assert.rejects(
      bookAppointment(
        db,
        { ...input, startsAt: "2026-06-01T00:01:00Z" },
        recovery,
        () => NOW,
      ),
      isCode("availability_conflict"),
    );
    await assertEmptyBooking(db);
    await bookAppointment(db, input, recovery, () => NOW);
    const result = await bookAppointment(
      db,
      { ...input, contact: null, startsAt: "invalid" },
      recovery,
      () => NOW + 100 * 86_400_000,
    );
    assert.equal(result.kind, "already_committed");
    assert.equal((await db.select().from(appointments)).length, 1);
    assert.equal((await db.select().from(clients)).length, 1);
  });
});

test("ordered nullable service snapshots and previous contacts survive returning-client and catalog changes", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    await db
      .update(services)
      .set({ durationMinutes: 15, cleanupMinutes: 5, priceCents: null })
      .where(eq(services.id, "cut_m"));
    const [second] = await db
      .select()
      .from(services)
      .where(eq(services.id, "cut_m"));
    const firstRecovery = await intent(db);
    const first = await bookAppointment(
      db,
      {
        ...input,
        serviceIds: ["cut_m", "cut_w"],
        reviewedServices: [second, input.reviewedServices[0]],
      },
      firstRecovery,
      () => NOW,
    );
    assert.equal(first.kind, "created");
    if (first.kind !== "created") throw new Error("Expected new booking");
    assert.equal(first.durationMinutes, 45);
    assert.equal(first.cleanupMinutes, 20);
    assert.equal(first.totalPriceCents, null);
    const before = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, first.appointmentId));
    const snapshots = await db
      .select()
      .from(appointmentServices)
      .where(eq(appointmentServices.appointmentId, first.appointmentId))
      .orderBy(appointmentServices.position);
    assert.deepEqual(
      snapshots.map((row) => [row.position, row.serviceId, row.priceCents]),
      [
        [0, "cut_m", null],
        [1, "cut_w", input.reviewedServices[0].priceCents],
      ],
    );
    const [clientBefore] = await db.select().from(clients);
    await bookAppointment(
      db,
      {
        ...input,
        startsAt: "2026-06-01T01:15:00Z",
        contact: {
          name: "Different guest",
          phone: "+359888123456",
          email: "other@example.test",
        },
      },
      await intent(db),
      () => NOW,
    );
    assert.deepEqual(await db.select().from(clients), [clientBefore]);
    const later = await db.select().from(appointments);
    assert.equal(later.length, 2);
    assert.ok(later.every((row) => row.clientId === clientBefore.id));
    assert.ok(
      later.some(
        (row) =>
          row.contactName === "Different guest" &&
          row.contactEmail === "other@example.test",
      ),
    );
    await db.update(services).set({
      name: "Changed",
      priceCents: 1,
      durationMinutes: 5,
      cleanupMinutes: 0,
    });
    await db.update(staff).set({ name: "Changed member" });
    await db
      .update(businessSettings)
      .set({ address: "Changed address", timeZone: "Europe/Sofia" });
    assert.deepEqual(
      await db
        .select()
        .from(appointments)
        .where(eq(appointments.id, first.appointmentId)),
      before,
    );
    assert.deepEqual(
      await db
        .select()
        .from(appointmentServices)
        .where(eq(appointmentServices.appointmentId, first.appointmentId))
        .orderBy(appointmentServices.position),
      snapshots,
    );
  });
});

test("late recovery-metadata failure rolls back every write and preserves the pending intent", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    const recovery = await intent(db);
    const before = await db.select().from(bookingOperations);
    const prepare = recovery.prepare;
    await assert.rejects(
      bookAppointment(
        db,
        input,
        {
          ...recovery,
          prepare: (booking) => ({
            ...prepare(booking),
            encryptedReplay: "invalid",
          }),
        },
        () => NOW,
      ),
    );
    await assertEmptyBooking(db);
    assert.deepEqual(await db.select().from(bookingOperations), before);
    const [catalog] = await db
      .select()
      .from(services)
      .where(eq(services.id, "cut_w"));
    assert.deepEqual(catalog, input.reviewedServices[0]);
    await bookAppointment(db, input, recovery, () => NOW); // same intent remains usable
    assert.equal((await db.select().from(appointments)).length, 1);
  });
});

test("current catalog, qualification, schedule, exceptions and occupancy supersede stale availability", async (t) => {
  const changes: [string, (db: NodePgDatabase) => Promise<unknown>][] = [
    [
      "inactive service",
      (db) =>
        db
          .update(services)
          .set({ isActive: false })
          .where(eq(services.id, "cut_w")),
    ],
    [
      "inactive staff",
      (db) =>
        db.update(staff).set({ isActive: false }).where(eq(staff.id, "mimi")),
    ],
    [
      "removed qualification",
      (db) => db.delete(staffServices).where(eq(staffServices.staffId, "mimi")),
    ],
    ["no staff hours", (db) => db.delete(staffSchedules)],
    ["no business hours", (db) => db.delete(businessHours)],
    [
      "business closure",
      (db) =>
        db.insert(scheduleExceptions).values({
          businessId: 1,
          onDate: "2026-06-01",
          windowIndex: 0,
          isClosed: true,
        }),
    ],
    [
      "staff closure",
      (db) =>
        db.insert(scheduleExceptions).values({
          staffId: "mimi",
          onDate: "2026-06-01",
          windowIndex: 0,
          isClosed: true,
        }),
    ],
    [
      "cleanup no longer fits",
      (db) => db.update(staffSchedules).set({ closesAt: "09:40" }),
    ],
    [
      "new occupied block",
      (db) =>
        db.insert(staffOccupancy).values({
          staffId: "mimi",
          kind: "block",
          period: "[2026-06-01T00:30:00Z,2026-06-01T00:45:00Z)",
        }),
    ],
    [
      "increased lead time",
      (db) => db.update(businessSettings).set({ leadTimeMinutes: 121 }),
    ],
  ];
  for (const [name, change] of changes)
    await t.test(name, async () => {
      await withTestDatabase({}, async ({ db }) => {
        const input = await fixture(db);
        const recovery = await intent(db);
        await change(db);
        const catalogBefore = await db.select().from(services);
        const blocksBefore = await db.select().from(staffOccupancy);
        await assert.rejects(
          bookAppointment(db, input, recovery, () => NOW),
          (error: unknown) =>
            error instanceof BookingError &&
            ["availability_conflict", "selection_unavailable"].includes(
              error.code,
            ),
        );
        assert.equal((await db.select().from(appointments)).length, 0);
        assert.equal((await db.select().from(clients)).length, 0);
        assert.equal((await db.select().from(appointmentServices)).length, 0);
        assert.equal((await db.select().from(appointmentAccess)).length, 0);
        assert.deepEqual(await db.select().from(staffOccupancy), blocksBefore);
        assert.deepEqual(await db.select().from(services), catalogBefore);
        assert.equal(
          (await db.select().from(bookingOperations))[0].state,
          "pending",
        );
      });
    });
});

test("strict instants/selections and invalid intent credentials are rejected without writes", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    const recovery = await intent(db);
    for (const startsAt of [
      "2026-06-01T09:00:00",
      "2026-02-30T09:00:00Z",
      "2026-06-01T09:00:01Z",
      "2026-06-01T09:00:00.001Z",
    ])
      await assert.rejects(
        bookAppointment(db, { ...input, startsAt }, recovery, () => NOW),
        isCode("invalid_booking"),
      );
    for (const serviceIds of [[], ["cut_w", "cut_w"]])
      await assert.rejects(
        bookAppointment(db, { ...input, serviceIds }, recovery, () => NOW),
        isCode("invalid_booking"),
      );
    await assert.rejects(
      bookAppointment(
        db,
        input,
        { ...recovery, credentialHash: "f".repeat(64) },
        () => NOW,
      ),
      isCode("operation_unavailable"),
    );
    await assert.rejects(
      bookAppointment(
        db,
        input,
        { ...recovery, operationId: randomUUID() },
        () => NOW,
      ),
      isCode("operation_unavailable"),
    );
    for (const state of ["abandoned", "tombstone"]) {
      await db.update(bookingOperations).set({ state });
      await assert.rejects(
        bookAppointment(db, input, recovery, () => NOW),
        isCode("operation_unavailable"),
      );
    }
    assert.equal((await db.select().from(appointments)).length, 0);
    assert.equal((await db.select().from(clients)).length, 0);
  });
});

test("acceptance rechecks lead equality and intent expiry after availability reads", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    const recovery = await intent(db);
    const boundary = Date.parse(input.startsAt) - 60 * 60_000;
    let samples = 0;
    await assert.rejects(
      bookAppointment(
        db,
        input,
        recovery,
        () => boundary + (samples++ === 0 ? 0 : 1),
      ),
      isCode("availability_conflict"),
    );
    assert.equal(samples, 2);
    await assertEmptyBooking(db);
    await db
      .update(bookingOperations)
      .set({ submitBefore: new Date(boundary + 1).toISOString() });
    samples = 0;
    await assert.rejects(
      bookAppointment(
        db,
        input,
        recovery,
        () => boundary + (samples++ === 0 ? 0 : 1),
      ),
      isCode("operation_unavailable"),
    );
    await assertEmptyBooking(db);
    await db
      .update(bookingOperations)
      .set({ submitBefore: new Date(boundary + 2).toISOString() });
    await bookAppointment(db, input, recovery, () => boundary);
    assert.equal(
      Date.parse((await db.select().from(appointments))[0].createdAt),
      boundary,
    );
  });
});

async function waitForBlocked(
  observer: Pick<NodePgDatabase, "execute">,
  pid: number,
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [row] = await observer.execute(
      sql`SELECT cardinality(pg_catalog.pg_blocking_pids(${pid})) > 0 AS waiting`,
      "objects",
    );
    if (row.waiting === true) return;
    await observer.execute(sql`SELECT pg_sleep(0.01)`);
  }
  assert.fail("second connection did not wait on the first transaction");
}

test("separate connections cannot commit overlapping bookings; loser leaves no partial client or appointment", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const input = await fixture(db);
    const firstIntent = await intent(db);
    const secondIntent = await intent(db);
    const [session] = await independentDb.execute(
      sql`SELECT pg_backend_pid() AS pid`,
      "objects",
    );
    let pending: ReturnType<typeof bookAppointment> | undefined;
    try {
      await db.transaction(async (tx) => {
        await bookAppointment(tx, input, firstIntent, () => NOW);
        pending = bookAppointment(
          independentDb,
          {
            ...input,
            contact: {
              name: "Other",
              phone: "+447911123456",
              email: "other@example.test",
            },
          },
          secondIntent,
          () => NOW,
        );
        void pending.catch(() => {});
        await waitForBlocked(tx, Number(session.pid));
      });
    } finally {
      if (pending)
        await assert.rejects(pending, isCode("availability_conflict"));
    }
    assert.equal((await db.select().from(appointments)).length, 1);
    assert.equal((await db.select().from(appointmentServices)).length, 1);
    assert.equal((await db.select().from(appointmentAccess)).length, 1);
    assert.equal((await db.select().from(staffOccupancy)).length, 1);
    assert.equal((await db.select().from(clients)).length, 1);
    const operations = await db.select().from(bookingOperations);
    assert.equal(
      operations.filter((row) => row.state === "committed").length,
      1,
    );
    assert.equal(operations.filter((row) => row.state === "pending").length, 1);
  });
});

test("synchronized independent connections can commit adjacent occupied intervals including cleanup", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const input = await fixture(db);
    const firstIntent = await intent(db);
    const secondIntent = await intent(db);
    const [session] = await independentDb.execute(
      sql`SELECT pg_backend_pid() AS pid`,
      "objects",
    );
    let pending: ReturnType<typeof bookAppointment> | undefined;
    try {
      await db.transaction(async (tx) => {
        const first = await bookAppointment(tx, input, firstIntent, () => NOW);
        assert.equal(first.kind, "created");
        const [stored] = await tx
          .select()
          .from(appointments)
          .where(eq(appointments.id, first.appointmentId));
        // Start exactly at occupied end, not service end: cleanup is occupied.
        assert.ok(
          Date.parse(stored.occupiedEndsAt) > Date.parse(stored.serviceEndsAt),
        );
        pending = bookAppointment(
          independentDb,
          { ...input, startsAt: new Date(stored.occupiedEndsAt).toISOString() },
          secondIntent,
          () => NOW,
        );
        void pending.catch(() => {});
        await waitForBlocked(tx, Number(session.pid));
      });
    } finally {
      if (pending) assert.equal((await pending).kind, "created");
    }
    const stored = await db
      .select()
      .from(appointments)
      .orderBy(appointments.startsAt);
    assert.equal(stored.length, 2);
    assert.equal(
      Date.parse(stored[0].occupiedEndsAt),
      Date.parse(stored[1].startsAt),
    );
    assert.equal((await db.select().from(staffOccupancy)).length, 2);
    assert.equal((await db.select().from(appointmentServices)).length, 2);
    assert.equal((await db.select().from(appointmentAccess)).length, 2);
    assert.ok(
      (await db.select().from(bookingOperations)).every(
        (row) => row.state === "committed",
      ),
    );
  });
});

test("same-phone concurrent bookings on different staff share one immutable client association", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const input = await fixture(db);
    await db.insert(staffSchedules).values({
      staffId: "pavel",
      weekday: 1,
      windowIndex: 0,
      opensAt: "09:00",
      closesAt: "12:00",
    });
    const firstIntent = await intent(db);
    const secondIntent = await intent(db);
    const [session] = await independentDb.execute(
      sql`SELECT pg_backend_pid() AS pid`,
      "objects",
    );
    let pending: ReturnType<typeof bookAppointment> | undefined;
    try {
      await db.transaction(async (tx) => {
        await bookAppointment(tx, input, firstIntent, () => NOW);
        pending = bookAppointment(
          independentDb,
          {
            ...input,
            staffId: "pavel",
            contact: {
              name: "Other guest",
              phone: "+359888123456",
              email: "other@example.test",
            },
          },
          secondIntent,
          () => NOW,
        );
        void pending.catch(() => {});
        await waitForBlocked(tx, Number(session.pid));
      });
    } finally {
      if (pending) assert.equal((await pending).kind, "created");
    }
    const people = await db.select().from(clients);
    const bookings = await db.select().from(appointments);
    assert.equal(people.length, 1);
    assert.equal(bookings.length, 2);
    assert.ok(bookings.every((row) => row.clientId === people[0].id));
    assert.deepEqual(bookings.map((row) => row.contactName).sort(), [
      "Guest One",
      "Other guest",
    ]);
    assert.equal((await db.select().from(staffOccupancy)).length, 2);
  });
});

test("actual PostgreSQL exclusion failure maps to availability conflict and rolls back all writes", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    const recovery = await intent(db);
    // Private-schema failure injector: create a conflicting block AFTER the
    // authoritative availability read, so the real GiST constraint is exercised.
    await db.execute(sql`CREATE FUNCTION inject_booking_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO staff_occupancy(staff_id, kind, period)
          VALUES (NEW.staff_id, 'block', tstzrange(NEW.starts_at, NEW.occupied_ends_at, '[)'));
        RETURN NEW;
      END $$`);
    await db.execute(sql`CREATE TRIGGER inject_booking_overlap BEFORE INSERT ON appointments
      FOR EACH ROW EXECUTE FUNCTION inject_booking_overlap()`);
    await assert.rejects(
      bookAppointment(db, input, recovery, () => NOW),
      isCode("availability_conflict"),
    );
    await assertEmptyBooking(db);
    await db.execute(sql`DROP TRIGGER inject_booking_overlap ON appointments`);
    await bookAppointment(db, input, recovery, () => NOW);
    assert.equal((await db.select().from(appointments)).length, 1);
  });
});

test("booking waits for configuration writers then uses changed schedule and current server time", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const input = await fixture(db);
    const recovery = await intent(db);
    const [session] = await independentDb.execute(
      sql`SELECT pg_backend_pid() AS pid`,
      "objects",
    );
    let pending: ReturnType<typeof bookAppointment> | undefined;
    let currentTime = NOW;
    const samples: number[] = [];
    try {
      await db.transaction(async (tx) => {
        await tx.select().from(staff).where(eq(staff.id, "mimi")).for("update");
        await tx.update(staffSchedules).set({ opensAt: "10:00" });
        pending = bookAppointment(independentDb, input, recovery, () => {
          samples.push(currentTime);
          return currentTime;
        });
        void pending.catch(() => {});
        await waitForBlocked(tx, Number(session.pid));
        currentTime = NOW + 30 * 60_000;
        assert.deepEqual(samples, []);
      });
    } finally {
      if (pending)
        await assert.rejects(pending, isCode("availability_conflict"));
    }
    assert.ok(
      samples.length > 0 && samples.every((sample) => sample === currentTime),
    );
    await assertEmptyBooking(db);
  });
});

test("booking lock timeout is retry/unknown, never a partial write or replacement intent", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const input = await fixture(db);
    const recovery = await intent(db);
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(bookingOperations)
        .where(eq(bookingOperations.id, recovery.operationId))
        .for("update");
      await assert.rejects(
        bookAppointment(independentDb, input, recovery, () => NOW),
        isCode("booking_busy"),
      );
    });
    await assertEmptyBooking(db);
    await bookAppointment(db, input, recovery, () => NOW);
    assert.equal((await db.select().from(appointments)).length, 1);
  });
});

test("day-60 closing boundary includes cleanup, allows adjacency, and never extends into day 61", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    for (const weekday of [5, 6]) {
      await db.insert(businessHours).values({
        businessId: 1,
        weekday,
        windowIndex: 0,
        opensAt: "09:00",
        closesAt: "12:00",
      });
      await db.insert(staffSchedules).values({
        staffId: "mimi",
        weekday,
        windowIndex: 0,
        opensAt: "09:00",
        closesAt: "12:00",
      });
    }
    for (const startsAt of [
      "2026-07-31T11:30:00+09:00",
      "2026-08-01T09:00:00+09:00",
    ]) {
      await assert.rejects(
        bookAppointment(
          db,
          { ...input, startsAt },
          await intent(db),
          () => NOW,
        ),
        isCode("availability_conflict"),
      );
      await assertEmptyBooking(db);
    }
    for (const startsAt of [
      "2026-07-31T11:15:00+09:00",
      "2026-07-31T10:30:00+09:00",
    ]) {
      await bookAppointment(
        db,
        { ...input, startsAt },
        await intent(db),
        () => NOW,
      );
    }
    const bookings = await db
      .select()
      .from(appointments)
      .orderBy(appointments.startsAt);
    assert.equal(bookings.length, 2);
    assert.equal(
      Date.parse(bookings[0].occupiedEndsAt),
      Date.parse(bookings[1].startsAt),
    );
    assert.equal(
      Date.parse(bookings[1].occupiedEndsAt),
      Date.parse("2026-07-31T12:00:00+09:00"),
    );
  });
});
