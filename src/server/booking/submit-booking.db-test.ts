import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  appointments,
  bookingOperations,
  businessHours,
  businessSettings,
  services,
  staffSchedules,
} from "@/db/schema";
import { seedCatalog } from "@/db/seed";
import { withTestDatabase } from "@/db/testing";
import { submitBooking } from "@/server/booking";
import type { BookingInput } from "@/server/booking/book-appointment";

// Direct use-case tests: submitBooking is exercised without the HTTP adapter to
// prove it owns registration-plus-submit orchestration and the business
// validation that must run before an intent is registered. Lifecycle, crypto,
// and recovery edge cases stay in booking-operation.db-test.
const NOW = Date.parse("2026-05-31T22:00:00Z");
const keys = () => ({
  fingerprint: { currentId: "h1", keys: { h1: Buffer.alloc(32, 1) } },
  replay: { currentId: "e1", keys: { e1: Buffer.alloc(32, 2) } },
});
const code = (expected: string) => (error: unknown) =>
  error instanceof Error && error.message === expected;

async function fixture(db: NodePgDatabase): Promise<{
  authorization: { operationId: string; credential: string };
  input: BookingInput;
}> {
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
    authorization: {
      operationId: "11111111-1111-4111-8111-111111111111",
      credential: "a".repeat(64),
    },
    input: {
      staffId: "mimi",
      serviceIds: ["cut_w"],
      startsAt: "2026-06-01T09:00:00+09:00",
      reviewedServices: [service],
      contact: {
        name: "Guest",
        phone: "0888 123 456",
        email: "guest@example.test",
        note: "Private",
      },
    },
  };
}

test("submitBooking registers a retained pair and creates the appointment once", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const { authorization, input } = await fixture(db);
    const receipt = await submitBooking(
      db,
      { authorization, input },
      { keys: keys(), clock: () => NOW },
    );
    assert.match(
      receipt.appointmentId,
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
    );
    assert.match(receipt.viewToken, /^[a-f0-9]{64}$/);
    const [appointment] = await db.select().from(appointments);
    assert.equal(appointment.id, receipt.appointmentId);
    const [operation] = await db.select().from(bookingOperations);
    assert.equal(operation.id, authorization.operationId);
    assert.equal(operation.state, "committed");
    assert.equal(operation.appointmentId, receipt.appointmentId);
  });
});

test("invalid input is rejected before any intent is registered", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const { authorization, input } = await fixture(db);
    await assert.rejects(
      submitBooking(
        db,
        // Minute-precision ISO without an offset fails canonical validation.
        { authorization, input: { ...input, startsAt: "2026-06-01T09:00" } },
        { keys: keys(), clock: () => NOW },
      ),
      code("invalid_booking"),
    );
    assert.equal((await db.select().from(bookingOperations)).length, 0);
    assert.equal((await db.select().from(appointments)).length, 0);
  });
});

test("an identical retry with the same pair replays the exact receipt", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const { authorization, input } = await fixture(db);
    const first = await submitBooking(
      db,
      { authorization, input },
      { keys: keys(), clock: () => NOW },
    );
    const retry = await submitBooking(
      db,
      { authorization, input },
      { keys: keys(), clock: () => NOW },
    );
    assert.deepEqual(retry, first);
    assert.equal((await db.select().from(appointments)).length, 1);
  });
});

test("a changed agreement under the same pair fails payload_conflict", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const { authorization, input } = await fixture(db);
    await submitBooking(
      db,
      { authorization, input },
      { keys: keys(), clock: () => NOW },
    );
    await assert.rejects(
      submitBooking(
        db,
        {
          authorization,
          input: {
            ...input,
            contact: { ...(input.contact as object), name: "Someone Else" },
          },
        },
        { keys: keys(), clock: () => NOW },
      ),
      code("payload_conflict"),
    );
    assert.equal((await db.select().from(appointments)).length, 1);
  });
});
