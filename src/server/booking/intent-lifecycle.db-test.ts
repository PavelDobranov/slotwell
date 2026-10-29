import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  appointmentAccess,
  appointments,
  bookingOperations,
  businessHours,
  businessSettings,
  services,
  staffSchedules,
} from "@/db/schema";
import { seedCatalog } from "@/db/seed";
import { withTestDatabase } from "@/db/testing";
import {
  clearBookingIntent,
  OperationError,
  resolveBookingIntent,
  submitBooking,
} from "@/server/booking";

const NOW = Date.parse("2026-05-31T22:00:00Z");
const authorization = () => ({
  operationId: "11111111-1111-4111-8111-111111111111",
  credential: "a".repeat(64),
});
const keys = () => ({
  fingerprint: { currentId: "h1", keys: { h1: Buffer.alloc(32, 1) } },
  replay: { currentId: "e1", keys: { e1: Buffer.alloc(32, 2) } },
});
const options = () => ({ keys: keys(), clock: () => NOW });
const code = (expected: string) => (error: unknown) =>
  error instanceof OperationError &&
  error.code === expected &&
  error.message === expected &&
  error.cause === undefined;

test("public resolution registers a retained pair and retries without extending its deadline", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const expected = {
      state: "pending",
      submitBefore: new Date(NOW + 86_400_000).toISOString(),
    };
    assert.deepEqual(
      await resolveBookingIntent(db, authorization(), options()),
      expected,
    );
    const original = await db.select().from(bookingOperations);
    assert.deepEqual(
      await resolveBookingIntent(db, authorization(), {
        keys: keys(),
        clock: () => NOW + 1_000,
      }),
      expected,
    );
    assert.deepEqual(await db.select().from(bookingOperations), original);
    await assert.rejects(
      resolveBookingIntent(db, authorization(), {
        keys: keys(),
        clock: () => NOW + 86_400_000,
      }),
      code("operation_unavailable"),
    );
    assert.deepEqual(await db.select().from(bookingOperations), original);
  });
});

test("public resolution replays a committed receipt; clear classifies without decrypting or mutation", async () => {
  await withTestDatabase({}, async ({ db }) => {
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
    const [service] = await db
      .select()
      .from(services)
      .where(eq(services.id, "cut_w"));
    const receipt = await submitBooking(
      db,
      {
        authorization: authorization(),
        input: {
          staffId: "mimi",
          serviceIds: [service.id],
          startsAt: "2026-06-01T09:00:00+09:00",
          reviewedServices: [service],
          contact: {
            name: "Guest",
            phone: "0888 123 456",
            email: "guest@example.test",
          },
        },
      },
      options(),
    );
    const history = async () => ({
      operations: await db.select().from(bookingOperations),
      appointments: await db.select().from(appointments),
      access: await db.select().from(appointmentAccess),
    });
    const original = await history();
    assert.deepEqual(
      await resolveBookingIntent(db, authorization(), options()),
      { state: "committed", receipt },
    );
    const rotatedKeys = {
      fingerprint: { currentId: "h2", keys: { h2: Buffer.alloc(32, 3) } },
      replay: { currentId: "e2", keys: { e2: Buffer.alloc(32, 4) } },
    };
    assert.deepEqual(
      await clearBookingIntent(db, authorization(), {
        keys: rotatedKeys,
        clock: () => NOW,
      }),
      { state: "committed" },
    );
    const expiry = Date.parse(receipt.confirmationExpiresAt);
    await assert.rejects(
      resolveBookingIntent(db, authorization(), {
        keys: keys(),
        clock: () => expiry,
      }),
      code("operation_unavailable"),
    );
    assert.deepEqual(
      await clearBookingIntent(db, authorization(), {
        keys: rotatedKeys,
        clock: () => expiry,
      }),
      { state: "committed" },
    );
    assert.deepEqual(await history(), original);
  });
});

test("public clear fences absent and pending pairs against delayed resolution", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const absent = authorization();
    const pending = {
      ...absent,
      operationId: "22222222-2222-4222-8222-222222222222",
      credential: "b".repeat(64),
    };
    await resolveBookingIntent(db, pending, options());
    for (const pair of [absent, pending]) {
      assert.deepEqual(await clearBookingIntent(db, pair, options()), {
        state: "fenced",
      });
      await assert.rejects(
        resolveBookingIntent(independentDb, pair, options()),
        code("operation_unavailable"),
      );
      assert.deepEqual(
        await clearBookingIntent(independentDb, pair, options()),
        { state: "fenced" },
      );
    }
    const rows = await db.select().from(bookingOperations);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.state === "abandoned"));
  });
});

test("public resolution owns the pair even across registration awaits and a lost result", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const caller = authorization();
    // Fail after registration commits, modelling a lost resolution/result.
    let calls = 0;
    const recovering = resolveBookingIntent(db, caller, {
      keys: keys(),
      clock: () => (++calls === 1 ? NOW : Number.NaN),
    });
    caller.operationId = "22222222-2222-4222-8222-222222222222";
    caller.credential = "b".repeat(64);
    await assert.rejects(recovering, code("recovery_unavailable"));
    const original = await db.select().from(bookingOperations);
    assert.equal(original.length, 1);
    assert.equal(original[0].id, authorization().operationId);
    assert.deepEqual(
      await resolveBookingIntent(db, authorization(), options()),
      {
        state: "pending",
        submitBefore: new Date(NOW + 86_400_000).toISOString(),
      },
    );
    assert.deepEqual(await db.select().from(bookingOperations), original);
  });
});

test("public clear owns the pair and refuses a savepoint acknowledgement", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const caller = authorization();
    const clearing = clearBookingIntent(db, caller, options());
    caller.operationId = "22222222-2222-4222-8222-222222222222";
    caller.credential = "b".repeat(64);
    assert.deepEqual(await clearing, { state: "fenced" });
    const rows = await db.select().from(bookingOperations);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, authorization().operationId);
    await db.transaction(async (tx) => {
      await assert.rejects(
        clearBookingIntent(tx, caller, options()),
        code("recovery_unavailable"),
      );
    });
    assert.deepEqual(await db.select().from(bookingOperations), rows);
  });
});

test("authorization getter failures never leak through the public lifecycle boundary", async () => {
  const pair = {
    get operationId(): string {
      throw new Error("private credential details");
    },
    credential: "a".repeat(64),
  };
  for (const action of [resolveBookingIntent, clearBookingIntent]) {
    await assert.rejects(
      action(undefined, pair, options()),
      code("recovery_unavailable"),
    );
  }
});

test("unexpected driver/setup errors never escape lifecycle use cases", async () => {
  const db = {
    transaction: async () => {
      throw new Error("private driver details");
    },
  } as unknown as NodePgDatabase;
  for (const action of [resolveBookingIntent, clearBookingIntent]) {
    await assert.rejects(
      action(db, authorization(), options()),
      code("recovery_unavailable"),
    );
  }
});

test("public lifecycle failures reveal only application codes", async () => {
  for (const action of [resolveBookingIntent, clearBookingIntent]) {
    await assert.rejects(
      action(undefined, authorization(), options()),
      code("recovery_unavailable"),
    );
  }
  await withTestDatabase({}, async ({ db }) => {
    await resolveBookingIntent(db, authorization(), options());
    const original = await db.select().from(bookingOperations);
    for (const action of [resolveBookingIntent, clearBookingIntent]) {
      await assert.rejects(
        action(
          db,
          { ...authorization(), credential: "b".repeat(64) },
          options(),
        ),
        code("operation_unavailable"),
      );
      await assert.rejects(
        action(
          db,
          {
            ...authorization(),
            operationId: "22222222-2222-4222-8222-222222222222",
          },
          options(),
        ),
        code("operation_unavailable"),
      );
    }
    assert.deepEqual(await db.select().from(bookingOperations), original);
  });
});
