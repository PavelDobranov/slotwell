import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
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
