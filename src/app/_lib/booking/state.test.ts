import assert from "node:assert/strict";
import test from "node:test";

import { createDemoSalon } from "@/app/_lib/booking/fixtures";
import {
  type BookingState,
  bookingReducer,
  initialBookingState,
  selectedTotals,
} from "@/app/_lib/booking/state";
import { localStart } from "@/app/_lib/booking/time";

const now = Date.parse("2026-06-01T05:00:00Z");
const salon = createDemoSalon(() => now);
const context = { salon, now };
const booked: BookingState = {
  ...initialBookingState,
  serviceIds: ["haircut"],
  path: "staff-first",
  step: "details",
  staffId: "mila",
  start: localStart("2026-06-01", 900),
  date: "2026-06-01",
  contact: { name: "Тест", phone: "0888123456", email: "", note: "" },
};

test("new bookings start time-first without inventing a time or specialist", () => {
  for (const state of [
    initialBookingState,
    bookingReducer(booked, { type: "new-booking" }, context),
  ]) {
    assert.equal(state.path, "time-first");
    assert.equal(state.step, "services");
    assert.equal(state.start, null);
    assert.equal(state.staffId, null);
    assert.deepEqual(state.serviceIds, []);
    const selected = bookingReducer(
      state,
      { type: "services", ids: ["haircut"] },
      context,
    );
    assert.equal(
      bookingReducer(selected, { type: "next" }, context).step,
      "time",
    );
  }
});

test("both route orders reach the same explicit service-staff-time combination", () => {
  for (const path of ["staff-first", "time-first"] as const) {
    let state = bookingReducer(
      initialBookingState,
      { type: "services", ids: ["haircut"] },
      context,
    );
    state = bookingReducer(state, { type: "path", path }, context);
    const choices =
      path === "staff-first"
        ? ([
            { type: "staff", id: "mila" },
            { type: "time", start: Number(booked.start) },
          ] as const)
        : ([
            { type: "time", start: Number(booked.start) },
            { type: "staff", id: "mila" },
          ] as const);
    for (const choice of choices) {
      state = bookingReducer(state, choice, context);
      if (choice.type === "time" && path === "time-first")
        assert.equal(state.staffId, null);
      state = bookingReducer(state, { type: "next" }, context);
    }
    assert.equal(state.step, "details");
    assert.equal(state.start, booked.start);
    assert.equal(state.staffId, booked.staffId);
  }
});

test("time-first changes preserve a valid time and clear staff unavailable for the full occupied interval", () => {
  const occupied = {
    ...context,
    sessionOccupied: [
      {
        staffId: "mila",
        start: Number(booked.start) + 35 * 60_000,
        end: Number(booked.start) + 40 * 60_000,
      },
    ],
  };
  // Haircut ends at :30 but cleanup occupies through :40; Ivan is still free.
  const result = bookingReducer(
    { ...booked, path: "time-first" },
    { type: "time", start: Number(booked.start) },
    occupied,
  );
  assert.equal(result.start, booked.start);
  assert.equal(result.staffId, null);
  assert.equal(result.step, "staff");
  assert.match(result.notice, /специалист/);
  assert.deepEqual(result.contact, booked.contact);
  const rejected = bookingReducer(
    result,
    { type: "staff", id: "mila" },
    occupied,
  );
  assert.equal(rejected.staffId, null);
  assert.equal(rejected.start, booked.start);
  assert.equal(
    bookingReducer(rejected, { type: "next" }, occupied).step,
    "staff",
  );
  const chosen = bookingReducer(
    rejected,
    { type: "staff", id: "ivan" },
    occupied,
  );
  assert.equal(
    bookingReducer(chosen, { type: "next" }, occupied).step,
    "details",
  );
});

test("time-first rejects stale starts and clamps switches and edits to the earliest unresolved step", () => {
  const expiredContext = { ...context, now: Number(booked.start) };
  const expired = bookingReducer(
    { ...booked, path: "time-first" },
    { type: "next" },
    expiredContext,
  );
  assert.equal(expired.start, null);
  assert.equal(expired.step, "time");
  const switched = bookingReducer(
    booked,
    { type: "path", path: "time-first" },
    expiredContext,
  );
  assert.equal(switched.start, null);
  assert.equal(switched.step, "time");
  const edited = bookingReducer(
    switched,
    { type: "edit", step: "staff" },
    expiredContext,
  );
  assert.equal(edited.step, "time");
  const back = bookingReducer(
    { ...booked, path: "time-first" },
    { type: "back" },
    context,
  );
  assert.equal(back.step, "staff");
  assert.equal(back.start, booked.start);
  const toStaffFirst = bookingReducer(
    back,
    { type: "path", path: "staff-first" },
    context,
  );
  assert.equal(toStaffFirst.step, "staff");
  assert.equal(toStaffFirst.start, booked.start);
  assert.equal(toStaffFirst.staffId, booked.staffId);
});

test("clock refresh revalidates choices without navigating or erasing recovery notices", () => {
  assert.deepEqual(
    bookingReducer(booked, { type: "refresh" }, context),
    booked,
  );
  const expired = bookingReducer(
    { ...booked, path: "time-first", step: "staff" },
    { type: "refresh" },
    { ...context, now: Number(booked.start) },
  );
  assert.equal(expired.step, "time");
  assert.equal(expired.start, null);
  assert.match(expired.notice, /час е премахнат/);
  assert.equal(
    bookingReducer(expired, { type: "refresh" }, context).notice,
    expired.notice,
  );
});

test("empty services cannot advance; totals treat services as a distinct set", () => {
  assert.equal(
    bookingReducer(initialBookingState, { type: "next" }, context).step,
    "services",
  );
  const selected = bookingReducer(
    initialBookingState,
    { type: "services", ids: ["haircut", "beard", "haircut", "unknown"] },
    context,
  );
  assert.deepEqual(selected.serviceIds, ["haircut", "beard"]);
  assert.deepEqual(selectedTotals(selected, salon), {
    priceCents: 3500,
    durationMinutes: 50,
    cleanupMinutes: 15,
  });
  assert.equal(
    bookingReducer(selected, { type: "next" }, context).step,
    "time",
  );
});

test("back, edit, path switches and contact updates preserve valid choices", () => {
  const edited = bookingReducer(
    booked,
    { type: "edit", step: "services" },
    context,
  );
  const unchanged = bookingReducer(
    edited,
    { type: "services", ids: ["haircut", "wash"] },
    context,
  );
  assert.equal(unchanged.staffId, "mila");
  assert.equal(unchanged.start, booked.start);
  const switched = bookingReducer(
    unchanged,
    { type: "path", path: "time-first" },
    context,
  );
  assert.equal(switched.step, "time");
  assert.equal(switched.start, booked.start);
  assert.equal(switched.staffId, "mila");
  assert.deepEqual(switched.contact, booked.contact);
  assert.equal(bookingReducer(booked, { type: "back" }, context).step, "time");
  assert.equal(
    bookingReducer({ ...booked, path: "time-first" }, { type: "back" }, context)
      .step,
    "staff",
  );
  assert.equal(
    bookingReducer(
      booked,
      { type: "contact", draft: { note: "Бележка" } },
      context,
    ).contact.note,
    "Бележка",
  );
});

test("ineligible staff is cleared, never replaced, while a still-valid time survives", () => {
  const result = bookingReducer(
    booked,
    { type: "services", ids: ["color"] },
    context,
  );
  assert.equal(result.staffId, null);
  assert.equal(result.start, booked.start);
  assert.equal(result.step, "staff");
  assert.match(result.notice, /специалист/);
  assert.deepEqual(result.contact, booked.contact);
});

test("longer services clear a time that no longer fits and return to time choice", () => {
  const late = { ...booked, start: localStart("2026-06-01", 1035) };
  const result = bookingReducer(
    late,
    { type: "services", ids: ["haircut", "wash"] },
    context,
  );
  assert.equal(result.staffId, "mila");
  assert.equal(result.start, null);
  assert.equal(result.step, "time");
  assert.match(result.notice, /час/);
});

test("time-first returns to earliest unresolved choice; empty services clear both", () => {
  const result = bookingReducer(
    { ...booked, path: "time-first" },
    { type: "services", ids: ["color", "beard"] },
    context,
  );
  assert.equal(result.step, "time");
  assert.equal(result.staffId, null);
  assert.equal(result.start, null);
  const empty = bookingReducer(booked, { type: "services", ids: [] }, context);
  assert.equal(empty.step, "services");
  assert.equal(empty.staffId, null);
  assert.equal(empty.start, null);
});

test("changing dates clears only starts from a different date and explains why", () => {
  const same = bookingReducer(
    booked,
    { type: "date", date: "2026-06-01" },
    context,
  );
  assert.equal(same.start, booked.start);
  const changed = bookingReducer(
    booked,
    { type: "date", date: "2026-06-02" },
    context,
  );
  assert.equal(changed.start, null);
  assert.equal(changed.staffId, "mila");
  assert.equal(changed.date, "2026-06-02");
  assert.deepEqual(changed.contact, booked.contact);
  assert.equal(changed.step, "time");
  assert.match(changed.notice, /дата/);
});

test("changing specialists preserves a shared start but clears an unavailable one", () => {
  const shared = bookingReducer(booked, { type: "staff", id: "ivan" }, context);
  assert.equal(shared.staffId, "ivan");
  assert.equal(shared.start, booked.start);
  const occupied = {
    ...context,
    sessionOccupied: [
      {
        staffId: "ivan",
        start: Number(booked.start),
        end: Number(booked.start) + 60_000,
      },
    ],
  };
  const changed = bookingReducer(
    booked,
    { type: "staff", id: "ivan" },
    occupied,
  );
  assert.equal(changed.staffId, "ivan");
  assert.equal(changed.start, null);
  assert.equal(changed.date, booked.date);
  assert.equal(changed.step, "time");
  assert.match(changed.notice, /час/);
});

test("a date outside the moving horizon is cleared on navigation", () => {
  const result = bookingReducer(
    booked,
    { type: "next" },
    { ...context, now: Date.parse("2026-06-02T05:00:00Z") },
  );
  assert.equal(result.date, null);
  assert.equal(result.start, null);
  assert.equal(result.step, "time");
  assert.match(result.notice, /Датата/);
});

test("current occupancy and lead time invalidate choices on navigation", () => {
  assert.notEqual(booked.start, null);
  const start = Number(booked.start);
  const occupied = {
    ...context,
    sessionOccupied: [
      {
        staffId: "mila",
        start: start,
        end: start + 60 * 60_000,
      },
    ],
  };
  const result = bookingReducer(booked, { type: "next" }, occupied);
  assert.equal(result.start, null);
  assert.equal(result.step, "time");
  const expired = bookingReducer(
    booked,
    { type: "next" },
    { ...context, now: start },
  );
  assert.equal(expired.start, null);
});
