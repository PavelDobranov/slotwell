import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addCalendarDays,
  businessDateAt,
  businessWeekday,
  formatBusinessDate,
  formatBusinessShortDate,
  formatBusinessTime,
  formatEuro,
  localStart,
} from "@/app/_lib/booking/time";

test("business dates and Bulgarian labels use Sofia rather than the device timezone", () => {
  const instant = Date.parse("2026-12-31T22:30:00Z");
  assert.equal(businessDateAt(instant), "2027-01-01");
  assert.equal(formatBusinessTime(instant), "00:30");
  assert.match(formatBusinessDate("2027-01-01"), /петък.*1 януари 2027/);
  assert.equal(formatEuro(3550), "35,50\u00a0€");
});

test("compact booking dates match the reference without a year", () => {
  assert.equal(formatBusinessShortDate("2026-10-24"), "сб, 24 окт.");
  assert.equal(formatBusinessShortDate("2026-06-01"), "пн, 1 юни");
});

test("calendar arithmetic crosses months, leap days, years and both DST changes", () => {
  for (const [date, days, expected] of [
    ["2026-01-31", 1, "2026-02-01"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2027-01-01", -1, "2026-12-31"],
    ["2026-03-28", 2, "2026-03-30"],
    ["2026-10-24", 2, "2026-10-26"],
    ["2026-03-01", 60, "2026-04-30"],
  ] as const) {
    assert.equal(addCalendarDays(date, days), expected);
  }

  assert.equal(businessWeekday("2026-03-29"), 0);
  assert.equal(businessWeekday("2026-03-30"), 1);
});

test("local starts resolve to explicit instants in winter and summer", () => {
  assert.equal(
    localStart("2026-01-15", 9 * 60),
    Date.parse("2026-01-15T07:00:00Z"),
  );
  assert.equal(
    localStart("2026-07-15", 9 * 60),
    Date.parse("2026-07-15T06:00:00Z"),
  );
  assert.equal(localStart("2026-01-01", 0), Date.parse("2025-12-31T22:00:00Z"));
});

test("DST gaps and repeated local starts are rejected, while adjacent times resolve", () => {
  for (let minute = 180; minute < 240; minute += 15) {
    assert.equal(localStart("2026-03-29", minute), null);
    assert.equal(localStart("2026-10-25", minute), null);
  }

  assert.equal(
    localStart("2026-03-29", 179),
    Date.parse("2026-03-29T00:59:00Z"),
  );
  assert.equal(
    localStart("2026-03-29", 240),
    Date.parse("2026-03-29T01:00:00Z"),
  );
  assert.equal(
    localStart("2026-10-25", 179),
    Date.parse("2026-10-24T23:59:00Z"),
  );
  assert.equal(
    localStart("2026-10-25", 240),
    Date.parse("2026-10-25T02:00:00Z"),
  );
});

test("invalid calendar dates and minute values fail instead of rolling over", () => {
  for (const date of ["2026-02-29", "2026-13-01", "2026-04-31", "26-01-01"]) {
    assert.throws(() => addCalendarDays(date, 1), RangeError);
    assert.throws(() => localStart(date, 600), RangeError);
  }

  for (const minute of [-1, 1440, 10.5, Number.NaN]) {
    assert.throws(() => localStart("2026-01-01", minute), RangeError);
  }

  assert.throws(() => addCalendarDays("2026-01-01", 0.5), RangeError);
});
