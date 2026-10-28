import assert from "node:assert/strict";
import { test } from "node:test";

import type { BookingInput } from "@/server/book-appointment";
import {
  canonicalBookingPayload,
  createBookingOperations,
} from "@/server/booking-operation";

const input: BookingInput = {
  staffId: "mimi",
  serviceIds: ["cut_w"],
  startsAt: "2026-06-01T09:00:00+09:00",
  reviewedServices: [
    {
      id: "cut_w",
      name: "Cut",
      priceCents: null,
      currency: "EUR",
      durationMinutes: 30,
      cleanupMinutes: 15,
    },
  ],
  contact: {
    name: " Guest ",
    phone: " 0888 123 456 ",
    email: " guest@example.test ",
    note: " private ",
  },
};

test("canonical agreement ignores object order, trimmed required whitespace and equivalent offsets", () => {
  const equivalent = {
    contact: {
      email: "guest@example.test",
      phone: "0888 123 456",
      name: "Guest",
      note: " private ",
    },
    reviewedServices: [
      {
        cleanupMinutes: 15,
        durationMinutes: 30,
        currency: "EUR",
        priceCents: null,
        name: "Cut",
        id: "cut_w",
      },
    ],
    startsAt: "2026-06-01T00:00:00.000Z",
    serviceIds: ["cut_w"],
    staffId: "mimi",
  };
  assert.equal(
    canonicalBookingPayload(input),
    canonicalBookingPayload(equivalent),
  );
  assert.equal(
    canonicalBookingPayload({
      ...input,
      contact: {
        name: "Guest",
        phone: "0888 123 456",
        email: "guest@example.test",
      },
    }),
    canonicalBookingPayload({
      ...input,
      contact: {
        name: "Guest",
        phone: "0888 123 456",
        email: "guest@example.test",
        note: "",
      },
    }),
  );
});

test("all submitted agreement fields and service ordering affect the fingerprint input", () => {
  const original = canonicalBookingPayload(input);
  const contact = input.contact as Record<string, string>;
  const variants: BookingInput[] = [
    { ...input, staffId: "other" },
    { ...input, startsAt: "2026-06-01T00:15:00Z" },
    { ...input, serviceIds: ["other"] },
    ...Object.entries({
      id: "other",
      name: "Other",
      priceCents: 0,
      currency: "BGN",
      durationMinutes: 45,
      cleanupMinutes: 0,
    }).map(([key, value]) => ({
      ...input,
      reviewedServices: [{ ...input.reviewedServices[0], [key]: value }],
    })),
    ...Object.entries({
      name: "Other",
      phone: "+359888123456",
      email: "Guest@example.test",
      note: "private",
      phoneCountry: "BG",
    }).map(([key, value]) => ({
      ...input,
      contact: { ...contact, [key]: value },
    })),
  ];
  for (const variant of variants)
    assert.notEqual(canonicalBookingPayload(variant), original);
  const two = {
    ...input,
    serviceIds: ["cut_w", "other"],
    reviewedServices: [
      ...input.reviewedServices,
      { ...input.reviewedServices[0], id: "other" },
    ],
  };
  assert.notEqual(
    canonicalBookingPayload(two),
    canonicalBookingPayload({
      ...two,
      serviceIds: [...two.serviceIds].reverse(),
      reviewedServices: [...two.reviewedServices].reverse(),
    }),
  );
});

test("snapshot values retain exact catalog whitespace and missing price cannot collide with null", () => {
  assert.notEqual(
    canonicalBookingPayload(input),
    canonicalBookingPayload({
      ...input,
      reviewedServices: [{ ...input.reviewedServices[0], name: " Cut " }],
    }),
  );
  const { priceCents: _price, ...missingPrice } = input.reviewedServices[0];
  assert.throws(
    () =>
      canonicalBookingPayload({
        ...input,
        reviewedServices: [missingPrice],
      } as BookingInput),
    /invalid_booking/,
  );
});

test("canonical input rejects invalid instants and malformed contact/snapshot values", () => {
  for (const variant of [
    { ...input, startsAt: "2026-06-01T09:00" },
    { ...input, startsAt: "2026-02-30T09:00Z" },
    { ...input, contact: null },
    {
      ...input,
      contact: { name: "Guest", phone: "123", email: "a@b.test", note: 123 },
    },
    {
      ...input,
      reviewedServices: [
        { ...input.reviewedServices[0], priceCents: Number.NaN },
      ],
    },
  ])
    assert.throws(() => canonicalBookingPayload(variant), /invalid_booking/);
});

test("canonical identifiers must be primitive strings, never mutable or coercible objects", () => {
  for (const patch of [
    { staffId: Object("mimi") },
    { staffId: 7 },
    { serviceIds: [7] },
    { serviceIds: [{ length: 4, toJSON: () => "cut_w" }] },
    { serviceIds: [Object("cut_w")] },
    { startsAt: Object(input.startsAt) },
  ])
    assert.throws(
      () => canonicalBookingPayload({ ...input, ...patch } as BookingInput),
      /invalid_booking/,
    );
});

test("registration rejects nonprimitive/malformed credentials before database access", async () => {
  const service = createBookingOperations({
    fingerprint: { currentId: "h1", keys: { h1: Buffer.alloc(32, 1) } },
    replay: { currentId: "e1", keys: { e1: Buffer.alloc(32, 2) } },
  });
  const valid = {
    operationId: "11111111-1111-4111-8111-111111111111",
    credential: "a".repeat(64),
  };
  const db = {
    transaction: async () => {
      assert.fail("malformed credentials must not access the database");
    },
  };
  for (const patch of [
    { operationId: "invalid" },
    { operationId: Object(valid.operationId) },
    { operationId: 1 },
    { credential: Object(valid.credential) },
    { credential: "A".repeat(64) },
    { credential: "a".repeat(63) },
    { credential: null },
  ]) {
    await assert.rejects(
      service.registerIntent(db, { ...valid, ...patch } as typeof valid),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "operation_unavailable");
        assert.ok(!Object.hasOwn(error, "cause"));
        return true;
      },
    );
  }
  await assert.rejects(
    service.registerIntent(db, valid, () => NaN),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "recovery_unavailable");
      assert.ok(!Object.hasOwn(error, "cause"));
      return true;
    },
  );
});

test("key configuration requires independent durable 32-byte keys and existing current IDs", () => {
  const good = {
    fingerprint: { currentId: "h1", keys: { h1: Buffer.alloc(32, 1) } },
    replay: { currentId: "e1", keys: { e1: Buffer.alloc(32, 2) } },
  };
  assert.ok(createBookingOperations(good));
  for (const bad of [
    {
      ...good,
      fingerprint: { currentId: "missing", keys: good.fingerprint.keys },
    },
    { ...good, replay: { currentId: "e1", keys: { e1: Buffer.alloc(31) } } },
    { ...good, replay: { currentId: "e1", keys: { e1: Buffer.alloc(32, 1) } } },
  ])
    assert.throws(() => createBookingOperations(bad), /recovery_unavailable/);
});
