import assert from "node:assert/strict";
import test from "node:test";

import { bookingProgress } from "@/app/_components/booking/stepper";
import {
  type BookingState,
  initialBookingState,
} from "@/app/_lib/booking/state";

const complete: BookingState = {
  ...initialBookingState,
  serviceIds: ["cut_m"],
  staffId: "pavel",
  start: 1,
  step: "details",
  contact: {
    name: "Demo",
    phone: "0888123456",
    email: "demo@example.com",
    note: "",
  },
};

for (const path of ["staff-first", "time-first"] as const) {
  test(`${path}: ordered selection screens share one milestone and edit target`, () => {
    const first = path === "staff-first" ? "staff" : "time";
    const second = path === "staff-first" ? "time" : "staff";
    for (const step of [first, second] as const) {
      const progress = bookingProgress({ ...complete, path, step }, false);
      assert.equal(progress.current, 1);
      assert.deepEqual(progress.targets, ["services", null, null, null]);
    }
    const details = bookingProgress({ ...complete, path }, false);
    assert.equal(details.current, 2);
    assert.deepEqual(details.targets, ["services", first, null, null]);
    const review = bookingProgress({ ...complete, path }, true);
    assert.equal(review.current, 3);
    assert.deepEqual(review.targets, ["services", first, "details", null]);
  });

  test(`${path}: missing choices and invalid contact never expose review`, () => {
    for (const missing of [
      { serviceIds: [] },
      { staffId: null },
      { start: null },
    ]) {
      const progress = bookingProgress({ ...complete, path, ...missing }, true);
      assert.ok(progress.current < 2);
      assert.equal(progress.targets[2], null);
    }
    assert.equal(
      bookingProgress(
        { ...complete, path, contact: initialBookingState.contact },
        true,
      ).current,
      2,
    );
    assert.equal(
      bookingProgress({ ...complete, path, step: "services" }, true).current,
      0,
    );
  });
}

test("initial progress cannot navigate to incomplete milestones", () => {
  assert.deepEqual(bookingProgress(initialBookingState, false), {
    current: 0,
    targets: [null, null, null, null],
  });
});
