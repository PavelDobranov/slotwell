import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  appointmentAccess,
  appointmentServices,
  appointments,
  bookingOperations,
  businessSettings,
  clients,
  services,
  staff,
} from "@/db/schema";
import { seedCatalog } from "@/db/seed";
import { withTestDatabase } from "@/db/testing";
import {
  ConfirmationError,
  readConfirmation,
} from "@/server/booking/confirmation";

const id = "11111111-1111-4111-8111-111111111111";
const token = "ab".repeat(32);
const start = Date.parse("2026-06-01T00:00:00Z");
const end = start + 60 * 60_000;
const expiry = end + 168 * 3_600_000;
const input = { appointmentId: id, viewToken: token };
const expected = {
  status: "confirmed",
  startsAt: new Date(start).toISOString(),
  serviceEndsAt: new Date(end).toISOString(),
  bookingTimeZone: "Asia/Tokyo",
  staffName: "Booked staff",
  businessAddress: "Booked address",
  confirmationExpiresAt: new Date(expiry).toISOString(),
  services: [
    { name: "First", priceCents: 1000, currency: "BGN", durationMinutes: 30 },
    { name: "Second", priceCents: null, currency: "BGN", durationMinutes: 30 },
  ],
};
async function fixture(db: NodePgDatabase) {
  await seedCatalog(db);
  await db.insert(clients).values({ id, normalizedPhone: "+359888123456" });
  await db.insert(appointments).values({
    id,
    clientId: id,
    staffId: "mimi",
    status: "confirmed",
    contactName: "Private guest",
    contactPhone: "+359888123456",
    contactEmail: "private@example.test",
    notes: "Private note",
    staffName: "Booked staff",
    businessAddress: "Booked address",
    bookingTimeZone: "Asia/Tokyo",
    startsAt: new Date(start).toISOString(),
    serviceEndsAt: new Date(end).toISOString(),
    occupiedEndsAt: new Date(end + 30 * 60_000).toISOString(),
    createdAt: new Date(start - 86_400_000).toISOString(),
    confirmationExpiresAt: new Date(expiry).toISOString(),
  });
  const catalog = await db.select().from(services).limit(2);
  // Insert in reverse order to ensure ordering is explicit, not incidental.
  await db.insert(appointmentServices).values(
    [1, 0].map((position) => ({
      appointmentId: id,
      position,
      serviceId: catalog[position].id,
      ...expected.services[position],
      cleanupMinutes: 15,
    })),
  );
  await db.insert(appointmentAccess).values({
    appointmentId: id,
    tokenHash: createHash("sha256")
      .update(Buffer.from(token, "hex"))
      .digest("hex"),
  });
}
async function history(db: NodePgDatabase) {
  return {
    appointments: await db.select().from(appointments),
    access: await db.select().from(appointmentAccess),
    services: await db
      .select()
      .from(appointmentServices)
      .orderBy(appointmentServices.position),
    operations: await db.select().from(bookingOperations),
  };
}
function code(expectedCode: string) {
  return (error: unknown) =>
    error instanceof ConfirmationError &&
    error.code === expectedCode &&
    error.message === expectedCode &&
    !("cause" in error);
}

test("confirmation is an exact ordered snapshot allowlist, independent from catalog and replay keys", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    await fixture(db);
    await db
      .update(staff)
      .set({ name: "Changed live staff" })
      .where(eq(staff.id, "mimi"));
    await db.update(businessSettings).set({ address: "Changed live address" });
    await db
      .update(services)
      .set({ name: "Changed live service", priceCents: 9999 });
    const before = await history(db);
    assert.deepEqual(
      await readConfirmation(independentDb, input, () => expiry - 1),
      expected,
    );
    assert.deepEqual(await history(db), before);
  });
});

test("wrong or crossed appointment credentials, missing access and exact expiry never expose or mutate history", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await fixture(db);
    const secondId = "22222222-2222-4222-8222-222222222222";
    const secondToken = "cd".repeat(32);
    const [original] = await db.select().from(appointments);
    await db.insert(appointments).values({ ...original, id: secondId });
    const bookedServices = await db.select().from(appointmentServices);
    await db.insert(appointmentServices).values(
      bookedServices.map((service) => ({
        ...service,
        appointmentId: secondId,
      })),
    );
    await db.insert(appointmentAccess).values({
      appointmentId: secondId,
      tokenHash: createHash("sha256")
        .update(Buffer.from(secondToken, "hex"))
        .digest("hex"),
    });
    assert.deepEqual(
      await readConfirmation(
        db,
        { appointmentId: secondId, viewToken: secondToken },
        () => start,
      ),
      expected,
    );
    const before = await history(db);
    for (const pair of [
      { ...input, viewToken: secondToken },
      { ...input, appointmentId: secondId },
    ])
      await assert.rejects(
        readConfirmation(db, pair, () => start),
        code("confirmation_unavailable"),
      );
    for (const now of [expiry, expiry + 1])
      await assert.rejects(
        readConfirmation(db, input, () => now),
        code("confirmation_unavailable"),
      );
    assert.deepEqual(await history(db), before);
    await db.delete(appointmentAccess);
    const pruned = await history(db);
    await assert.rejects(
      readConfirmation(db, input, () => start),
      code("confirmation_unavailable"),
    );
    assert.deepEqual(await history(db), pruned);
  });
});

test("application rejects malformed primitive credentials before database I/O", async () => {
  const db = {
    select: () => {
      throw new Error("must not read");
    },
  } as unknown as NodePgDatabase;
  for (const value of [
    null,
    {},
    { ...input, viewToken: new String(token) },
    { ...input, viewToken: token.toUpperCase() },
    { ...input, appointmentId: 123 },
    { ...input, viewToken: "a" },
  ]) {
    await assert.rejects(
      readConfirmation(db, value as typeof input),
      code("confirmation_unavailable"),
    );
  }
});

test("invalid clocks and driver failures are redacted without mutation", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await fixture(db);
    const before = await history(db);
    for (const now of [NaN, Infinity, 8.64e15 + 1])
      await assert.rejects(
        readConfirmation(db, input, () => now),
        code("confirmation_temporarily_unavailable"),
      );
    assert.deepEqual(await history(db), before);
  });
  const db = {
    select: () => {
      throw new Error("private database diagnostic");
    },
  } as unknown as NodePgDatabase;
  await assert.rejects(
    readConfirmation(db, input),
    code("confirmation_temporarily_unavailable"),
  );
});

test("authenticated incomplete or inconsistent snapshots fail closed", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await fixture(db);
    for (const change of [
      () => db.update(appointments).set({ bookingTimeZone: "Not/AZone" }),
      () =>
        db
          .update(appointmentServices)
          .set({ currency: "EUR" })
          .where(eq(appointmentServices.position, 1)),
      () =>
        db
          .update(appointmentServices)
          .set({ durationMinutes: 31 })
          .where(eq(appointmentServices.position, 1)),
      () =>
        db
          .update(appointmentServices)
          .set({ position: 2 })
          .where(eq(appointmentServices.position, 1)),
      () => db.delete(appointmentServices),
    ]) {
      await db.transaction(async (tx) => {
        // Each corruption satisfies SQL constraints; restore it after the read.
        await tx.execute(sql`SAVEPOINT corruption`);
        await change();
        const before = await history(db);
        await assert.rejects(
          readConfirmation(db, input, () => start),
          code("confirmation_temporarily_unavailable"),
        );
        assert.deepEqual(await history(db), before);
        await tx.execute(sql`ROLLBACK TO SAVEPOINT corruption`);
      });
    }
  });
});

test("trusted time is sampled after a real database wait crossing expiry", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    await fixture(db);
    const pid = (
      await independentDb.execute<{ pid: number }>(
        sql`select pg_backend_pid() as pid`,
      )
    ).rows[0].pid;
    let now = expiry - 1;
    let sampled = false;
    await db.execute(sql`BEGIN`);
    let reading: ReturnType<typeof readConfirmation> | undefined;
    try {
      await db.execute(
        sql`LOCK TABLE appointment_access IN ACCESS EXCLUSIVE MODE`,
      );
      reading = readConfirmation(independentDb, input, () => {
        sampled = true;
        return now;
      });
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const result = await db.execute<{ blocked: boolean }>(
          sql`select cardinality(pg_blocking_pids(${pid})) > 0 as blocked`,
        );
        if (result.rows[0].blocked) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.ok(blocked, "confirmation read reached the database lock");
      assert.equal(sampled, false);
      now = expiry;
    } finally {
      await db.execute(sql`ROLLBACK`);
    }
    assert.ok(reading);
    await assert.rejects(reading, code("confirmation_unavailable"));
    assert.equal(sampled, true);
  });
});
