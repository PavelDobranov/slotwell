import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  appointmentAccess,
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
import type { BookingInput } from "@/server/book-appointment";
import { createBookingOperations } from "@/server/booking-operation";

const NOW = Date.parse("2026-05-31T22:00:00Z");
const keys = () => ({
  fingerprint: { currentId: "h1", keys: { h1: Buffer.alloc(32, 1) } },
  replay: { currentId: "e1", keys: { e1: Buffer.alloc(32, 2) } },
});
const code = (expected: string) => (error: unknown) =>
  error instanceof Error && error.message === expected;
const hash = (value: string) =>
  createHash("sha256").update(Buffer.from(value, "hex")).digest("hex");
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
      name: "Guest",
      phone: "0888 123 456",
      email: "guest@example.test",
      note: "Private",
    },
  };
}

test("independent durable intents store only credential hashes and a 24-hour deadline", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await fixture(db);
    for (const table of [
      appointmentAccess,
      appointments,
      clients,
      staffOccupancy,
    ]) {
      assert.equal((await db.select().from(table)).length, 0);
    }
    const operations = createBookingOperations(keys());
    const first = await operations.createIntent(db, () => NOW);
    const second = await operations.createIntent(db, () => NOW);
    assert.notEqual(first.operationId, second.operationId);
    assert.notEqual(first.credential, second.credential);
    assert.match(first.credential, /^[a-f0-9]{64}$/);
    const rows = await db.select().from(bookingOperations);
    assert.equal(rows.length, 2);
    const stored = rows.find((row) => row.id === first.operationId);
    assert.equal(stored?.credentialHash, hash(first.credential));
    assert.equal(Date.parse(stored?.submitBefore ?? ""), NOW + 86_400_000);
    assert.equal(stored?.state, "pending");
    assert.ok(!JSON.stringify(rows).includes(first.credential));
  });
});

test("a discarded commit response is recoverable across instances and identical retries", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const input = await fixture(db);
    const service = createBookingOperations(keys());
    const intent = await service.createIntent(db, () => NOW);
    await service.submit(db, intent, input, () => NOW); // Deliberately discard the response.
    const restarted = createBookingOperations(keys());
    const result = await restarted.submit(
      independentDb,
      intent,
      input,
      () => NOW + 86_400_001,
    );
    assert.deepEqual(await restarted.recover(db, intent, () => NOW), result);
    const [access] = await db.select().from(appointmentAccess);
    assert.equal(access.tokenHash, hash(result.viewToken));
    assert.equal(access.appointmentId, result.appointmentId);
    assert.deepEqual(Object.keys(result).sort(), [
      "appointmentId",
      "confirmationExpiresAt",
      "viewToken",
    ]);
    const [operation] = await db.select().from(bookingOperations);
    const [appointment] = await db.select().from(appointments);
    assert.equal(
      Date.parse(operation.replayExpiresAt ?? ""),
      Date.parse(appointment.confirmationExpiresAt),
    );
    assert.ok(!JSON.stringify(operation).includes(result.viewToken));
    assert.ok(!JSON.stringify(operation).includes("guest@example.test"));
    await db.update(services).set({ name: "Changed", durationMinutes: 45 });
    await db.update(businessSettings).set({ defaultPhoneCountry: "GB" });
    assert.deepEqual(
      await restarted.submit(db, intent, input, () => NOW),
      result,
    );
    for (const patch of [
      { startsAt: "2026-06-01T00:15:00Z" },
      { contact: { ...(input.contact as object), note: "Changed" } },
      { reviewedServices: [{ ...input.reviewedServices[0], priceCents: 0 }] },
    ])
      await assert.rejects(
        restarted.submit(db, intent, { ...input, ...patch }, () => NOW),
        code("payload_conflict"),
      );
    await assert.rejects(
      restarted.recover(
        db,
        { ...intent, credential: "f".repeat(64) },
        () => NOW,
      ),
      code("operation_unavailable"),
    );
    assert.equal((await db.select().from(appointments)).length, 1);
    assert.equal((await db.select().from(clients)).length, 1);
    assert.equal((await db.select().from(staffOccupancy)).length, 1);
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
  assert.fail("retry did not wait on the operation lock");
}

test("synchronized concurrent identical submissions share one booking and private token", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const input = await fixture(db);
    const service = createBookingOperations(keys());
    const intent = await service.createIntent(db, () => NOW);
    const [session] = await independentDb.execute(
      sql`SELECT pg_backend_pid() AS pid`,
      "objects",
    );
    let duplicate: ReturnType<typeof service.submit> | undefined;
    const first = await db.transaction(async (tx) => {
      const created = await service.submit(tx, intent, input, () => NOW);
      duplicate = service.submit(independentDb, intent, input, () => NOW);
      void duplicate.catch(() => {});
      await waitForBlocked(tx, Number(session.pid));
      return created;
    });
    assert.deepEqual(await duplicate, first);
    assert.equal((await db.select().from(appointments)).length, 1);
    assert.equal((await db.select().from(appointmentAccess)).length, 1);
  });
});

test("submission snapshots mutable input before waiting on the operation lock", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const input = await fixture(db);
    const original = structuredClone(input);
    const service = createBookingOperations(keys());
    const intent = await service.createIntent(db, () => NOW);
    const [session] = await independentDb.execute(
      sql`SELECT pg_backend_pid() AS pid`,
      "objects",
    );
    let pending: ReturnType<typeof service.submit> | undefined;
    await db.transaction(async (tx) => {
      await tx.select().from(bookingOperations).for("update");
      pending = service.submit(independentDb, intent, input, () => NOW);
      void pending.catch(() => {});
      await waitForBlocked(tx, Number(session.pid));
      (input.contact as Record<string, string>).name = "Changed";
      input.serviceIds[0] = "changed";
      input.reviewedServices[0].name = "Changed";
    });
    const result = await pending;
    assert.deepEqual(
      await service.submit(db, intent, original, () => NOW),
      result,
    );
    assert.equal(
      (await db.select().from(appointments))[0].contactName,
      "Guest",
    );
  });
});

test("old key IDs survive rotation; missing keys and tampered/swapped replay fail closed", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    const service = createBookingOperations(keys());
    const intent = await service.createIntent(db, () => NOW);
    const result = await service.submit(db, intent, input, () => NOW);
    const rotated = {
      fingerprint: {
        currentId: "h2",
        keys: { ...keys().fingerprint.keys, h2: Buffer.alloc(32, 3) },
      },
      replay: {
        currentId: "e2",
        keys: { ...keys().replay.keys, e2: Buffer.alloc(32, 4) },
      },
    };
    assert.deepEqual(
      await createBookingOperations(rotated).submit(
        db,
        intent,
        input,
        () => NOW,
      ),
      result,
    );
    const missing = {
      fingerprint: { currentId: "h2", keys: { h2: Buffer.alloc(32, 3) } },
      replay: { currentId: "e2", keys: { e2: Buffer.alloc(32, 4) } },
    };
    await assert.rejects(
      createBookingOperations(missing).submit(db, intent, input, () => NOW),
      code("recovery_unavailable"),
    );
    const [operation] = await db.select().from(bookingOperations);
    await db
      .update(bookingOperations)
      .set({ encryptedReplay: "00".repeat(60) });
    await assert.rejects(
      service.recover(db, intent, () => NOW),
      code("recovery_unavailable"),
    );
    await db
      .update(bookingOperations)
      .set({ encryptedReplay: operation.encryptedReplay });
    await db.update(appointmentAccess).set({ tokenHash: "0".repeat(64) });
    await assert.rejects(
      service.recover(db, intent, () => NOW),
      code("recovery_unavailable"),
    );
    assert.equal((await db.select().from(appointments)).length, 1);
  });
});

test("a failed booking rolls back and the same pending credential can retry", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    const service = createBookingOperations(keys());
    const intent = await service.createIntent(db, () => NOW);
    await assert.rejects(
      service.submit(
        db,
        intent,
        { ...input, startsAt: "2026-06-01T02:45:00Z" },
        () => NOW,
      ),
      code("availability_conflict"),
    );
    for (const table of [
      appointments,
      appointmentAccess,
      clients,
      staffOccupancy,
    ])
      assert.equal((await db.select().from(table)).length, 0);
    assert.equal(
      (await db.select().from(bookingOperations))[0].state,
      "pending",
    );
    await assert.rejects(
      service.recover(db, intent, () => NOW),
      code("operation_unavailable"),
    );
    const result = await service.submit(db, intent, input, () => NOW);
    assert.equal(
      (await db.select().from(appointments))[0].id,
      result.appointmentId,
    );
  });
});
