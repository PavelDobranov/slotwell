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

test("pre-persisted browser credentials register once and duplicates cannot extend their deadline", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const service = createBookingOperations(keys());
    const intent = {
      operationId: "11111111-1111-4111-8111-111111111111",
      credential: "a".repeat(64),
    };
    assert.equal(
      await service.registerIntent(db, intent, () => NOW),
      undefined,
    );
    const [original] = await db.select().from(bookingOperations);
    assert.equal(original.id, intent.operationId);
    assert.equal(original.credentialHash, hash(intent.credential));
    assert.equal(original.state, "pending");
    assert.equal(Date.parse(original.createdAt), NOW);
    assert.equal(Date.parse(original.submitBefore), NOW + 86_400_000);
    assert.ok(!JSON.stringify(original).includes(intent.credential));
    await service.registerIntent(independentDb, intent, () => NOW + 1000);
    await service.registerIntent(independentDb, intent, () => NOW + 86_400_000);
    assert.deepEqual(await db.select().from(bookingOperations), [original]);
    for (const other of [
      { ...intent, credential: "b".repeat(64) },
      { ...intent, operationId: "22222222-2222-4222-8222-222222222222" },
    ]) {
      await assert.rejects(
        service.registerIntent(db, other, () => NOW),
        code("operation_unavailable"),
      );
      assert.deepEqual(await db.select().from(bookingOperations), [original]);
    }
  });
});

test("registration preserves committed, expired, abandoned and tombstone operations", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    const service = createBookingOperations(keys());
    const committed = await service.createIntent(db, () => NOW);
    const receipt = await service.submit(db, committed, input, () => NOW);
    const intents = [committed];
    for (const state of ["abandoned", "tombstone"]) {
      const intent = await service.createIntent(db, () => NOW);
      await db
        .update(bookingOperations)
        .set({ state })
        .where(eq(bookingOperations.id, intent.operationId));
      intents.push(intent);
    }
    const original = await db.select().from(bookingOperations);
    for (const intent of intents)
      await service.registerIntent(db, intent, () =>
        Date.parse(receipt.confirmationExpiresAt),
      );
    assert.deepEqual(await db.select().from(bookingOperations), original);
    assert.deepEqual(await service.recover(db, committed, () => NOW), receipt);
    for (const intent of intents.slice(1))
      await assert.rejects(
        service.submit(db, intent, input, () => NOW),
        code("operation_unavailable"),
      );
    assert.equal((await db.select().from(appointments)).length, 1);
  });
});

test("concurrent registration serializes both uniqueness constraints and snapshots credentials", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const service = createBookingOperations(keys());
    const [session] = await independentDb.execute(
      sql`SELECT pg_backend_pid() AS pid`,
      "objects",
    );
    for (const [index, variant] of [
      "same",
      "different_credential",
      "different_id",
    ].entries()) {
      const first = {
        operationId: `11111111-1111-4111-8111-11111111111${index}`,
        credential: String(index + 1).repeat(64),
      };
      const duplicate = {
        ...first,
        ...(variant === "different_credential"
          ? { credential: "f".repeat(64) }
          : {}),
        ...(variant === "different_id"
          ? { operationId: `22222222-2222-4222-8222-22222222222${index}` }
          : {}),
      };
      let pending: Promise<void> | undefined;
      await db.transaction(async (tx) => {
        await service.registerIntent(tx, first, () => NOW);
        pending = service.registerIntent(
          independentDb,
          duplicate,
          () => NOW + 1000,
        );
        void pending.catch(() => {});
        await waitForBlocked(tx, Number(session.pid));
        duplicate.operationId = "33333333-3333-4333-8333-333333333333";
        duplicate.credential = "e".repeat(64);
      });
      assert.ok(pending);
      if (variant === "same") await pending;
      else await assert.rejects(pending, code("operation_unavailable"));
      const [stored] = await db
        .select()
        .from(bookingOperations)
        .where(eq(bookingOperations.id, first.operationId));
      assert.equal(stored.credentialHash, hash(first.credential));
      assert.equal(Date.parse(stored.submitBefore), NOW + 86_400_000);
      assert.equal(
        (await db.select().from(bookingOperations)).length,
        index + 1,
      );
    }
  });
});

test("lost registration acknowledgements and rolled-back claims retry the saved credentials", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const service = createBookingOperations(keys());
    const intent = {
      operationId: "11111111-1111-4111-8111-111111111111",
      credential: "a".repeat(64),
    };
    const losesAcknowledgement: Pick<NodePgDatabase, "transaction"> = {
      transaction: async (action, options) => {
        await db.transaction(action, options);
        throw new Error(`private transport failure ${intent.credential}`);
      },
    };
    await assert.rejects(
      service.registerIntent(losesAcknowledgement, intent, () => NOW),
      code("recovery_unavailable"),
    );
    await service.registerIntent(independentDb, intent, () => NOW + 1000);
    assert.equal((await db.select().from(bookingOperations)).length, 1);
    assert.equal(
      Date.parse((await db.select().from(bookingOperations))[0].createdAt),
      NOW,
    );
    const rollback = {
      ...intent,
      operationId: "22222222-2222-4222-8222-222222222222",
      credential: "b".repeat(64),
    };
    await assert.rejects(
      db.transaction(async (tx) => {
        await service.registerIntent(tx, rollback, () => NOW);
        throw new Error("deliberate rollback");
      }),
      /deliberate rollback/,
    );
    assert.equal((await db.select().from(bookingOperations)).length, 1);
    await service.registerIntent(independentDb, rollback, () => NOW + 2000);
    assert.equal((await db.select().from(bookingOperations)).length, 2);
  });
});

test("registration lock timeout is an unknown outcome and cannot replace the existing row", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const service = createBookingOperations(keys());
    const intent = await service.createIntent(db, () => NOW);
    const original = await db.select().from(bookingOperations);
    await db.transaction(async (tx) => {
      await tx.select().from(bookingOperations).for("update");
      await assert.rejects(
        service.registerIntent(independentDb, intent, () => NOW + 1000),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, "recovery_unavailable");
          assert.ok(!Object.hasOwn(error, "cause"));
          assert.ok(!error.stack?.includes(intent.credential));
          return true;
        },
      );
      assert.deepEqual(await tx.select().from(bookingOperations), original);
    });
    await service.registerIntent(independentDb, intent, () => NOW + 2000);
    assert.deepEqual(await db.select().from(bookingOperations), original);
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

test("exclusive expiry forbids replay and pruning retains history plus permanent tombstones", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    const service = createBookingOperations(keys());
    const intent = await service.createIntent(db, () => NOW);
    const pending = await service.createIntent(db, () => NOW);
    assert.equal(
      await service.pruneExpired(
        db,
        pending.operationId,
        () => NOW + 86_399_999,
      ),
      false,
    );
    await assert.rejects(
      service.submit(db, pending, input, () => NOW + 86_400_000),
      code("operation_unavailable"),
    );
    assert.equal(
      await service.pruneExpired(
        db,
        pending.operationId,
        () => NOW + 86_400_000,
      ),
      true,
    );
    await assert.rejects(
      service.submit(db, pending, input, () => NOW),
      code("operation_unavailable"),
    );
    const result = await service.submit(db, intent, input, () => NOW);
    const expiry = Date.parse(result.confirmationExpiresAt);
    assert.equal(
      await service.pruneExpired(db, intent.operationId, () => expiry - 1),
      false,
    );
    assert.deepEqual(
      await service.submit(db, intent, input, () => expiry - 1),
      result,
    );
    await assert.rejects(
      service.recover(db, intent, () => expiry),
      code("operation_unavailable"),
    );
    await assert.rejects(
      service.submit(db, intent, input, () => expiry),
      code("operation_unavailable"),
    );
    assert.equal((await db.select().from(appointmentAccess)).length, 1); // expiry independent of physical pruning
    assert.equal(
      await service.pruneExpired(db, intent.operationId, () => expiry),
      true,
    );
    assert.equal(
      await service.pruneExpired(db, intent.operationId, () => expiry),
      false,
    );
    const [stored] = await db
      .select()
      .from(bookingOperations)
      .where(eq(bookingOperations.id, intent.operationId));
    assert.equal(stored.state, "tombstone");
    assert.equal(stored.credentialHash, hash(intent.credential));
    for (const field of [
      "appointmentId",
      "payloadFingerprint",
      "fingerprintVersion",
      "fingerprintKeyId",
      "encryptedReplay",
      "replayKeyId",
      "replayExpiresAt",
    ] as const)
      assert.equal(stored[field], null);
    assert.equal((await db.select().from(appointmentAccess)).length, 0);
    assert.equal((await db.select().from(appointments)).length, 1);
    assert.equal((await db.select().from(staffOccupancy)).length, 1);
    await assert.rejects(
      service.submit(db, intent, input, () => NOW),
      code("operation_unavailable"),
    );
  });
});

test("inconsistent replay expiry cannot authorize early pruning or recovery", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    const service = createBookingOperations(keys());
    const intent = await service.createIntent(db, () => NOW);
    await service.submit(db, intent, input, () => NOW);
    await db
      .update(bookingOperations)
      .set({ replayExpiresAt: new Date(NOW + 1000).toISOString() });
    await assert.rejects(
      service.pruneExpired(db, intent.operationId, () => NOW + 1000),
      code("recovery_unavailable"),
    );
    await assert.rejects(
      service.recover(db, intent, () => NOW),
      code("recovery_unavailable"),
    );
    assert.equal((await db.select().from(appointmentAccess)).length, 1);
    assert.equal(
      (await db.select().from(bookingOperations))[0].state,
      "committed",
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

test("a replay waiting across expiry fails; maintenance serializes with a pending-to-committed transition", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const input = await fixture(db);
    const service = createBookingOperations(keys());
    const intent = await service.createIntent(db, () => NOW);
    const [session] = await independentDb.execute(
      sql`SELECT pg_backend_pid() AS pid`,
      "objects",
    );
    let maintenance: ReturnType<typeof service.pruneExpired> | undefined;
    const result = await db.transaction(async (tx) => {
      const receipt = await service.submit(tx, intent, input, () => NOW);
      maintenance = service.pruneExpired(
        independentDb,
        intent.operationId,
        () => NOW + 86_400_000,
      );
      void maintenance.catch(() => {});
      await waitForBlocked(tx, Number(session.pid));
      return receipt;
    });
    assert.equal(await maintenance, false); // Must reread committed state, not expire stale pending state.
    const expiry = Date.parse(result.confirmationExpiresAt);
    let clock = expiry - 1;
    let replay: ReturnType<typeof service.recover> | undefined;
    await db.transaction(async (tx) => {
      await tx.select().from(bookingOperations).for("update");
      replay = service.recover(independentDb, intent, () => clock);
      void replay.catch(() => {});
      await waitForBlocked(tx, Number(session.pid));
      clock = expiry;
      assert.equal(
        await service.pruneExpired(tx, intent.operationId, () => expiry),
        true,
      );
    });
    assert.ok(replay);
    await assert.rejects(replay, code("operation_unavailable"));
    assert.equal((await db.select().from(appointmentAccess)).length, 0);
  });
});

test("expiry is sampled after lock wait even when physical pruning has not happened", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const input = await fixture(db);
    const service = createBookingOperations(keys());
    const intent = await service.createIntent(db, () => NOW);
    const result = await service.submit(db, intent, input, () => NOW);
    const [session] = await independentDb.execute(
      sql`SELECT pg_backend_pid() AS pid`,
      "objects",
    );
    let clock = Date.parse(result.confirmationExpiresAt) - 1;
    let replay: ReturnType<typeof service.submit> | undefined;
    await db.transaction(async (tx) => {
      await tx.select().from(bookingOperations).for("update");
      replay = service.submit(independentDb, intent, input, () => clock);
      void replay.catch(() => {});
      await waitForBlocked(tx, Number(session.pid));
      clock++;
    });
    assert.ok(replay);
    await assert.rejects(replay, code("operation_unavailable"));
    assert.equal((await db.select().from(appointmentAccess)).length, 1);
  });
});

test("an in-flight lock timeout stays unknown and retries only the same intent", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const input = await fixture(db);
    const service = createBookingOperations(keys());
    const intent = await service.createIntent(db, () => NOW);
    await db.transaction(async (tx) => {
      await tx.select().from(bookingOperations).for("update");
      await assert.rejects(
        service.submit(independentDb, intent, input, () => NOW),
        code("recovery_unavailable"),
      );
      assert.equal(
        (await tx.select().from(bookingOperations))[0].state,
        "pending",
      );
      assert.equal((await tx.select().from(appointments)).length, 0);
    });
    await service.submit(db, intent, input, () => NOW);
    assert.equal((await db.select().from(appointments)).length, 1);
    assert.equal((await db.select().from(bookingOperations)).length, 1);
  });
});

test("a transaction whose committed acknowledgement is lost resolves without a replacement", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const input = await fixture(db);
    const service = createBookingOperations(keys());
    const intent = await service.createIntent(db, () => NOW);
    const losesAcknowledgement: Pick<NodePgDatabase, "transaction"> = {
      transaction: async (action, options) => {
        await db.transaction(action, options);
        throw new Error(
          `private transport failure ${intent.credential} guest@example.test`,
        );
      },
    };
    await assert.rejects(
      service.submit(losesAcknowledgement, intent, input, () => NOW),
      code("recovery_unavailable"),
    );
    const result = await service.recover(independentDb, intent, () => NOW);
    assert.deepEqual(
      await service.submit(db, intent, input, () => NOW),
      result,
    );
    assert.equal((await db.select().from(appointments)).length, 1);
    assert.equal((await db.select().from(bookingOperations)).length, 1);
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

test("encrypted replay is bound to its operation and appointment, not interchangeable ciphertext", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    const configuration = keys();
    const service = createBookingOperations(configuration);
    // Mutating the caller-owned key buffers cannot change an existing instance.
    configuration.fingerprint.keys.h1.fill(9);
    configuration.replay.keys.e1.fill(9);
    const first = await service.createIntent(db, () => NOW);
    const second = await service.createIntent(db, () => NOW);
    const a = await service.submit(db, first, input, () => NOW);
    const b = await service.submit(
      db,
      second,
      { ...input, startsAt: "2026-06-01T00:45:00Z" },
      () => NOW,
    );
    assert.notEqual(a.viewToken, b.viewToken);
    assert.deepEqual(
      await createBookingOperations(keys()).recover(db, first, () => NOW),
      a,
    );
    const [storedA] = await db
      .select()
      .from(bookingOperations)
      .where(eq(bookingOperations.id, first.operationId));
    const [storedB] = await db
      .select()
      .from(bookingOperations)
      .where(eq(bookingOperations.id, second.operationId));
    assert.notEqual(
      storedA.encryptedReplay?.slice(0, 24),
      storedB.encryptedReplay?.slice(0, 24),
    );
    await db
      .update(bookingOperations)
      .set({ encryptedReplay: storedA.encryptedReplay })
      .where(eq(bookingOperations.id, second.operationId));
    await assert.rejects(
      service.recover(db, second, () => NOW),
      code("recovery_unavailable"),
    );
    assert.deepEqual(await service.recover(db, first, () => NOW), a);
    assert.equal((await db.select().from(appointments)).length, 2);
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
