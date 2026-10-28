import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addCalendarDays,
  addElapsedMinutes,
  assertIanaTimeZone,
  BOOKING_GRID_MINUTES,
  businessDate,
  businessWeekday,
  isGridAligned,
  type LocalStart,
  resolveLocalStart,
  toOffsetIso,
  toUtcIso,
} from "@/shared/booking-time";

const SOFIA = "Europe/Sofia";
const NEW_YORK = "America/New_York"; // non-European DST zone
const KOLKATA = "Asia/Kolkata"; // non-DST zone, half-hour offset

function hhmm(hour: number, minute = 0): number {
  return hour * 60 + minute;
}

function okInstant(result: LocalStart): number {
  assert.equal(result.kind, "ok");
  // Narrow for TypeScript.
  if (result.kind !== "ok") throw new Error("unreachable");
  return result.instant;
}

test("assertIanaTimeZone accepts named zones and rejects offsets and unknowns", () => {
  for (const zone of [SOFIA, NEW_YORK, KOLKATA, "UTC"]) {
    assert.doesNotThrow(() => assertIanaTimeZone(zone));
  }
  for (const bad of ["+02:00", "+0530", "GMT+2", "UTC+3", "Not/AZone", ""]) {
    assert.throws(() => assertIanaTimeZone(bad), RangeError);
  }
});

test("businessDate reads the local calendar date, not the UTC date", () => {
  // 22:30Z is already the next local day in Sofia (+02:00/+03:00).
  const instant = Date.parse("2026-06-01T22:30:00Z");
  assert.equal(businessDate(instant, SOFIA), "2026-06-02");
  assert.equal(businessDate(instant, "UTC"), "2026-06-01");
});

test("addCalendarDays is zone-free and reversible across boundaries", () => {
  assert.equal(addCalendarDays("2026-03-28", 1), "2026-03-29"); // across spring DST
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01"); // year rollover
  assert.equal(addCalendarDays("2026-03-01", -1), "2026-02-28"); // non-leap February
  for (const date of ["2026-01-15", "2026-10-25"]) {
    assert.equal(addCalendarDays(addCalendarDays(date, 60), -60), date);
  }
  assert.throws(() => addCalendarDays("2026-13-01", 1), RangeError);
});

test("businessWeekday puts Sunday at 0 (EU DST transitions are Sundays)", () => {
  assert.equal(businessWeekday("2026-03-29"), 0);
  assert.equal(businessWeekday("2026-10-25"), 0);
  assert.equal(businessWeekday("2026-03-30"), 1);
});

test("isGridAligned enforces the midnight-anchored 15-minute grid", () => {
  assert.equal(BOOKING_GRID_MINUTES, 15);
  for (const minute of [0, 15, 540, 1425]) {
    assert.equal(isGridAligned(minute), true);
  }
  for (const minute of [1, 10, 7, -15, 1440]) {
    assert.equal(isGridAligned(minute), false);
  }
});

test("resolveLocalStart maps a normal Sofia start to the exact instant", () => {
  const result = resolveLocalStart("2026-06-01", hhmm(10), SOFIA);
  assert.equal(okInstant(result), Date.parse("2026-06-01T07:00:00Z")); // +03:00
});

test("resolveLocalStart rejects the Sofia spring-forward gap (03:00–03:59)", () => {
  assert.equal(
    resolveLocalStart("2026-03-29", hhmm(3, 0), SOFIA).kind,
    "nonexistent",
  );
  assert.equal(
    resolveLocalStart("2026-03-29", hhmm(3, 30), SOFIA).kind,
    "nonexistent",
  );
  // Boundaries on either side of the gap still resolve.
  assert.equal(resolveLocalStart("2026-03-29", hhmm(2, 59), SOFIA).kind, "ok");
  assert.equal(
    okInstant(resolveLocalStart("2026-03-29", hhmm(4, 0), SOFIA)),
    Date.parse("2026-03-29T01:00:00Z"),
  );
});

test("resolveLocalStart rejects the Sofia fall-back overlap (03:00–03:59)", () => {
  assert.equal(
    resolveLocalStart("2026-10-25", hhmm(3, 0), SOFIA).kind,
    "ambiguous",
  );
  assert.equal(
    resolveLocalStart("2026-10-25", hhmm(3, 30), SOFIA).kind,
    "ambiguous",
  );
  assert.equal(resolveLocalStart("2026-10-25", hhmm(2, 59), SOFIA).kind, "ok");
  assert.equal(resolveLocalStart("2026-10-25", hhmm(4, 0), SOFIA).kind, "ok");
});

test("resolveLocalStart handles a non-European DST zone (America/New_York)", () => {
  // Spring forward: 02:00 -> 03:00 on 2026-03-08.
  assert.equal(
    resolveLocalStart("2026-03-08", hhmm(2, 30), NEW_YORK).kind,
    "nonexistent",
  );
  // Fall back: 02:00 -> 01:00 on 2026-11-01.
  assert.equal(
    resolveLocalStart("2026-11-01", hhmm(1, 30), NEW_YORK).kind,
    "ambiguous",
  );
  // A plain winter start resolves at -05:00.
  assert.equal(
    okInstant(resolveLocalStart("2026-01-15", hhmm(9), NEW_YORK)),
    Date.parse("2026-01-15T14:00:00Z"),
  );
});

test("resolveLocalStart handles a non-DST half-hour zone (Asia/Kolkata)", () => {
  const result = resolveLocalStart("2026-06-01", hhmm(10), KOLKATA);
  assert.equal(okInstant(result), Date.parse("2026-06-01T04:30:00Z")); // +05:30, no gaps/overlaps ever
  assert.equal(
    resolveLocalStart("2026-03-29", hhmm(3, 30), KOLKATA).kind,
    "ok",
  );
});

test("addElapsedMinutes keeps real duration across a spring-forward transition", () => {
  const start = okInstant(resolveLocalStart("2026-03-29", hhmm(2, 30), SOFIA)); // +02:00 -> 00:30Z
  const end = addElapsedMinutes(start, 60);
  // Exactly one elapsed hour, even though the wall clock jumps 02:30 -> 04:30.
  assert.equal(end - start, 60 * 60_000);
  assert.equal(toOffsetIso(start, SOFIA), "2026-03-29T02:30:00+02:00");
  assert.equal(toOffsetIso(end, SOFIA), "2026-03-29T04:30:00+03:00");
  assert.throws(() => addElapsedMinutes(start, -5), RangeError);
});

test("serialization yields UTC and explicit business-offset forms", () => {
  const instant = Date.parse("2026-06-01T07:00:00Z");
  assert.equal(toUtcIso(instant), "2026-06-01T07:00:00.000Z");
  assert.equal(toOffsetIso(instant, SOFIA), "2026-06-01T10:00:00+03:00");
  assert.equal(toOffsetIso(instant, KOLKATA), "2026-06-01T12:30:00+05:30");
  // A winter instant carries Sofia's +02:00 offset.
  assert.equal(
    toOffsetIso(Date.parse("2026-01-15T08:00:00Z"), SOFIA),
    "2026-01-15T10:00:00+02:00",
  );
});
