import assert from "node:assert/strict";
import test from "node:test";

import { availableSlots } from "@/app/_lib/booking/availability";
import { createDemoSalon } from "@/app/_lib/booking/fixtures";
import { createDemoSession } from "@/app/_lib/booking/session";
import {
  type BookingState,
  bookingReducer,
  initialBookingState,
} from "@/app/_lib/booking/state";
import { localStart } from "@/app/_lib/booking/time";

const now = Date.parse("2026-06-01T05:00:00Z");
const salon = createDemoSalon(() => now);
const selection: BookingState = {
  ...initialBookingState,
  step: "details",
  serviceIds: ["haircut"],
  staffId: "mila",
  start: localStart("2026-06-01", 900),
  date: "2026-06-01",
  contact: {
    name: "Демо",
    phone: "0888123456",
    email: "demo@example.com",
    note: "",
  },
};
const immediate = async () => {};

for (const path of ["staff-first", "time-first"] as const) {
  test(`${path} conflict blocks the interval without booking the visitor and returns to time selection`, async () => {
    const draft = { ...selection, path };
    const session = createDemoSession(salon, () => now, immediate, "conflict");
    assert.equal(await session.confirm(draft), "unavailable");
    const recovered = bookingReducer(
      draft,
      { type: "conflict" },
      {
        salon,
        now,
        sessionOccupied: session.occupied,
      },
    );
    assert.equal(recovered.step, "time");
    assert.equal(recovered.start, null);
    assert.deepEqual(recovered.serviceIds, draft.serviceIds);
    assert.deepEqual(recovered.contact, draft.contact);
    assert.equal(await session.confirm(draft), "unavailable");
    assert.equal(session.occupied.length, 1);
    assert.equal(
      await session.confirm({
        ...draft,
        start: Number(draft.start) + 60 * 60_000,
      }),
      "success",
    );
    assert.equal(session.occupied.length, 2);
  });

  test(`${path} retryable failure preserves the draft, consumes the scenario once and cannot duplicate occupancy`, async () => {
    const draft = { ...selection, path };
    const snapshot = structuredClone(draft);
    const session = createDemoSession(salon, () => now, immediate, "retryable");
    assert.equal(await session.confirm({ ...draft, start: null }), "invalid");
    assert.equal(await session.confirm(draft), "retryable");
    assert.deepEqual(session.occupied, []);
    assert.deepEqual(draft, snapshot);
    const results = await Promise.all([
      session.confirm(draft),
      session.confirm(draft),
    ]);
    assert.deepEqual(results, ["success", "pending"]);
    assert.equal(session.occupied.length, 1);
    assert.equal(await session.confirm(draft), "unavailable");
    assert.equal(session.occupied.length, 1);
  });
}

test("confirmation appends one interval including cleanup and rejects duplicate submissions", async () => {
  let release = () => {};
  const session = createDemoSession(
    salon,
    () => now,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const first = session.confirm(selection);
  assert.equal(await session.confirm(selection), "pending");
  assert.deepEqual(session.occupied, []);
  release();
  assert.equal(await first, "success");
  assert.deepEqual(session.occupied, [
    {
      staffId: "mila",
      start: selection.start,
      end: Number(selection.start) + 40 * 60_000,
    },
  ]);
  // A completed interval cannot be booked again, even on the time-first path.
  const second = session.confirm({ ...selection, path: "time-first" });
  release();
  assert.equal(await second, "unavailable");
  assert.equal(session.occupied.length, 1);
});

test("confirmation reads the injected clock after pending work, not page-open time", async () => {
  let current = now;
  const session = createDemoSession(
    salon,
    () => current,
    async () => {
      current = Number(selection.start);
    },
  );
  assert.equal(await session.confirm(selection), "unavailable");
  assert.deepEqual(session.occupied, []);
});

test("invalid contacts, missing selections and unavailable specialists cannot confirm", async () => {
  for (const invalid of [
    { ...selection, contact: initialBookingState.contact },
    { ...selection, staffId: null },
    { ...selection, start: null },
    { ...selection, serviceIds: [] },
    { ...selection, staffId: "unknown" },
  ]) {
    const session = createDemoSession(salon, () => now, immediate);
    assert.notEqual(await session.confirm(invalid), "success");
    assert.deepEqual(session.occupied, []);
  }
});

test("new booking resets contact and choices but retains session occupancy; a fresh session is empty", async () => {
  const session = createDemoSession(salon, () => now, immediate);
  assert.equal(await session.confirm(selection), "success");
  const reset = bookingReducer(
    selection,
    { type: "new-booking" },
    { salon, now, sessionOccupied: session.occupied },
  );
  assert.deepEqual(reset, initialBookingState);
  const slots = (occupied = session.occupied) =>
    availableSlots({
      salon,
      now,
      serviceIds: ["haircut"],
      staffId: "mila",
      date: "2026-06-01",
      sessionOccupied: occupied,
    });
  assert.equal(
    slots().some(({ start }) => start === selection.start),
    false,
  );
  const freshSession = createDemoSession(salon, () => now, immediate);
  assert.deepEqual(freshSession.occupied, []);
  assert.equal(
    slots(freshSession.occupied).some(({ start }) => start === selection.start),
    true,
  );
});
