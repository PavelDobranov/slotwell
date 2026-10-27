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
  services,
  staffOccupancy,
  staffSchedules,
} from "@/db/schema";
import { seedCatalog } from "@/db/seed";
import { withTestDatabase } from "@/db/testing";
import {
  BookingError,
  type BookingInput,
  type BookingRecovery,
  bookAppointment,
} from "@/server/book-appointment";

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
