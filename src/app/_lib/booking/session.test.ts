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
