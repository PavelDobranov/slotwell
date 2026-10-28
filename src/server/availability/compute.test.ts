import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type AvailabilityBusiness,
  type AvailabilityInput,
  type AvailabilityStaff,
  type AvailableSlot,
  computeAvailability,
  type ScheduleException,
  type SelectedService,
  type WeeklyWindow,
} from "@/server/availability/compute";
import { toOffsetIso } from "@/shared/booking-time";

const SOFIA = "Europe/Sofia";
const TOKYO = "Asia/Tokyo";

// Monday, inside Sofia summer time (EEST, +03:00). No DST transition nearby.
const NOW = Date.parse("2026-06-01T00:00:00+03:00");

const hm = (hour: number, minute = 0): number => hour * 60 + minute;

function everyDay(opensMinute: number, closesMinute: number): WeeklyWindow[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    opensMinute,
    closesMinute,
  }));
}

// Business-local "HH:MM" of an instant in a zone.
function localTime(instant: number, timeZone: string): string {
  return toOffsetIso(instant, timeZone).slice(11, 16);
}

function service(
  id: string,
  durationMinutes: number,
  cleanupMinutes = 0,
): SelectedService {
  return { id, durationMinutes, cleanupMinutes };
}

function staff(
  id: string,
  qualifiedServiceIds: string[],
  extra: Partial<Omit<AvailabilityStaff, "id" | "qualifiedServiceIds">> = {},
): AvailabilityStaff {
  return {
    id,
    qualifiedServiceIds,
    weekly: extra.weekly ?? everyDay(hm(9), hm(17)),
    exceptions: extra.exceptions ?? [],
    occupied: extra.occupied ?? [],
  };
}

type InputOverrides = {
  now?: number;
  business?: Partial<AvailabilityBusiness>;
  staff?: AvailabilityStaff[];
  services?: SelectedService[];
};

// A single-staff, single-service booking day with sensible defaults, overridable.
function input(overrides: InputOverrides = {}): AvailabilityInput {
  return {
    now: overrides.now ?? NOW,
    business: {
      timeZone: SOFIA,
      leadTimeMinutes: 60,
      horizonDays: 0,
      weekly: everyDay(hm(9), hm(17)),
      exceptions: [],
      ...overrides.business,
    },
    staff: overrides.staff ?? [staff("s1", ["cut"])],
    services: overrides.services ?? [service("cut", 60)],
  };
}

test("bounded dates restrict work without changing lead time or horizon", () => {
  const base = input({ business: { horizonDays: 3 } });
  const all = computeAvailability(base);
  const dateRange = { from: "2026-06-02", to: "2026-06-03" };
  assert.deepEqual(
    computeAvailability({ ...base, dateRange }),
    all.filter(
      (slot) => slot.date >= dateRange.from && slot.date <= dateRange.to,
    ),
  );
  assert.deepEqual(
    computeAvailability({
      ...base,
      dateRange: { from: "2026-05-30", to: "2026-06-05" },
    }),
    all,
  );
  for (const date of ["2026-05-31", "2026-06-05"]) {
    assert.deepEqual(
      computeAvailability({ ...base, dateRange: { from: date, to: date } }),
      [],
    );
  }
  const late = input({ now: Date.parse("2026-06-01T16:00:00+03:00") });
  assert.deepEqual(
    computeAvailability({
      ...late,
      dateRange: { from: "2026-06-01", to: "2026-06-01" },
    }),
    [],
  );
});

const MINUTE_MS = 60_000;

test("single service: 15-minute grid within hours, whole interval fits", () => {
  const slots = computeAvailability(input());

  // 09:00 … 16:00 (last start whose 60-min end lands on the 17:00 close).
  assert.equal(slots.length, 29);
  assert.equal(localTime(slots[0].start, SOFIA), "09:00");
  assert.equal(localTime(slots[0].end, SOFIA), "10:00");
  assert.equal(localTime(slots[slots.length - 1].start, SOFIA), "16:00");
  assert.equal(localTime(slots[slots.length - 1].end, SOFIA), "17:00");
  assert.deepEqual(slots[0].staffIds, ["s1"]);
  // Consecutive grid spacing.
  assert.equal(slots[1].start - slots[0].start, 15 * MINUTE_MS);
});

test("multi-service: consecutive durations plus summed trailing cleanup", () => {
  const slots = computeAvailability(
    input({
      staff: [staff("s1", ["cut", "color"])],
      services: [service("cut", 30, 10), service("color", 45, 5)],
    }),
  );

  const first = slots[0];
  // end = start + (30 + 45); occupiedEnd = end + (10 + 5).
  assert.equal(first.end - first.start, 75 * MINUTE_MS);
  assert.equal(first.occupiedEnd - first.end, 15 * MINUTE_MS);
  // Last start must fit the full 90-minute occupied interval before 17:00.
  assert.equal(localTime(slots[slots.length - 1].start, SOFIA), "15:30");
  assert.equal(localTime(slots[slots.length - 1].occupiedEnd, SOFIA), "17:00");
});

test("qualification: a staff member must cover every selected service", () => {
  const slots = computeAvailability(
    input({
      staff: [staff("s1", ["cut", "color"]), staff("s2", ["cut"])],
      services: [service("cut", 60), service("color", 30)],
    }),
  );

  assert.ok(slots.length > 0);
  for (const slot of slots) {
    assert.deepEqual(slot.staffIds, ["s1"]);
  }
});

test("no qualified staff yields no slots", () => {
  const slots = computeAvailability(
    input({
      staff: [staff("s2", ["cut"])],
      services: [service("cut", 60), service("color", 30)],
    }),
  );

  assert.deepEqual(slots, []);
});

test("business closure exception closes the whole day", () => {
  const closed: ScheduleException = { onDate: "2026-06-01", isClosed: true };
  const slots = computeAvailability(
    input({ business: { exceptions: [closed] } }),
  );

  assert.deepEqual(slots, []);
});

test("staff closure exception removes only that staff member", () => {
  const closed: ScheduleException = { onDate: "2026-06-01", isClosed: true };
  const slots = computeAvailability(
    input({
      staff: [
        staff("s1", ["cut"], { exceptions: [closed] }),
        staff("s2", ["cut"]),
      ],
    }),
  );

  assert.ok(slots.length > 0);
  for (const slot of slots) {
    assert.deepEqual(slot.staffIds, ["s2"]);
  }
});

test("override exception replaces the weekly window for the date", () => {
  const override: ScheduleException = {
    onDate: "2026-06-01",
    isClosed: false,
    opensMinute: hm(12),
    closesMinute: hm(14),
  };
  const slots = computeAvailability(
    input({
      business: {
        exceptions: [override],
      },
    }),
  );

  // 12:00 … 13:00 (last 60-min booking ends at the 14:00 override close).
  assert.equal(slots.length, 5);
  assert.equal(localTime(slots[0].start, SOFIA), "12:00");
  assert.equal(localTime(slots[slots.length - 1].start, SOFIA), "13:00");
});

test("a service longer than the window yields no slots", () => {
  const slots = computeAvailability(input({ services: [service("cut", 600)] }));

  assert.deepEqual(slots, []);
});

test("lead time is inclusive at exactly now + lead", () => {
  // now 08:00, lead 60 → earliest start is exactly 09:00, which is offered.
  const onBoundary = computeAvailability(
    input({ now: Date.parse("2026-06-01T08:00:00+03:00") }),
  );
  assert.equal(localTime(onBoundary[0].start, SOFIA), "09:00");

  // One minute later, 09:00 falls before the lead boundary and drops out.
  const pastBoundary = computeAvailability(
    input({ now: Date.parse("2026-06-01T08:01:00+03:00") }),
  );
  assert.equal(localTime(pastBoundary[0].start, SOFIA), "09:15");
});

test("horizon closes at business-local today + horizonDays, inclusive", () => {
  const slots = computeAvailability(input({ business: { horizonDays: 60 } }));

  const dates = [...new Set(slots.map((s) => s.date))].sort();
  assert.equal(dates.length, 61); // today … today + 60, inclusive
  assert.equal(dates[0], "2026-06-01");
  assert.equal(dates.at(-1), "2026-07-31");
  assert.ok(slots.every((s) => s.date <= "2026-07-31"));
});

test("occupied intervals: touching boundaries allowed, overlaps rejected", () => {
  const occupied = [
    {
      startInstant: Date.parse("2026-06-01T10:00:00+03:00"),
      endInstant: Date.parse("2026-06-01T11:00:00+03:00"),
    },
  ];
  const slots = computeAvailability(
    input({ staff: [staff("s1", ["cut"], { occupied })] }),
  );
  const starts = new Set(slots.map((s) => localTime(s.start, SOFIA)));

  // Touch the occupied start (09:00 booking ends exactly at 10:00) — allowed.
  assert.ok(starts.has("09:00"));
  // Touch the occupied end (11:00 booking starts exactly at 11:00) — allowed.
  assert.ok(starts.has("11:00"));
  // Overlapping starts are rejected.
  assert.ok(!starts.has("09:30"));
  assert.ok(!starts.has("10:00"));
  assert.ok(!starts.has("10:45"));
});

test("multi-zone: identical local rules resolve to zone-correct instants", () => {
  const build = (timeZone: string, now: number): AvailableSlot[] =>
    computeAvailability(
      input({
        now,
        business: { timeZone, leadTimeMinutes: 0 },
      }),
    );

  const sofia = build(SOFIA, Date.parse("2026-06-01T00:00:00+03:00"));
  const tokyo = build(TOKYO, Date.parse("2026-06-01T00:00:00+09:00"));

  // Same local grid in both zones …
  assert.equal(sofia.length, tokyo.length);
  assert.equal(
    localTime(sofia[0].start, SOFIA),
    localTime(tokyo[0].start, TOKYO),
  );
  // … but different absolute instants / offsets.
  assert.equal(toOffsetIso(sofia[0].start, SOFIA), "2026-06-01T09:00:00+03:00");
  assert.equal(toOffsetIso(tokyo[0].start, TOKYO), "2026-06-01T09:00:00+09:00");
  assert.notEqual(sofia[0].start, tokyo[0].start);
});

test("DST spring-forward: nonexistent local starts are excluded", () => {
  // 2026-03-29 Sofia: 03:00–03:59 never happens (clocks jump 03:00 → 04:00).
  // Both business and staff open all day so the window spans the gap.
  const slots = computeAvailability(
    input({
      now: Date.parse("2026-03-28T00:00:00+02:00"),
      business: {
        leadTimeMinutes: 0,
        horizonDays: 2,
        weekly: everyDay(hm(0), hm(23, 59)),
      },
      staff: [staff("s1", ["cut"], { weekly: everyDay(hm(0), hm(23, 59)) })],
      services: [service("cut", 15)],
    }),
  );
  const starts = new Set(
    slots
      .filter((s) => s.date === "2026-03-29")
      .map((s) => localTime(s.start, SOFIA)),
  );

  assert.ok(starts.has("02:45"));
  assert.ok(starts.has("04:00"));
  for (const gap of ["03:00", "03:15", "03:30", "03:45"]) {
    assert.ok(!starts.has(gap), `${gap} should be excluded`);
  }
});

test("DST fall-back: ambiguous local starts are excluded", () => {
  // 2026-10-25 Sofia: 03:00–03:59 happens twice (clocks fall 04:00 → 03:00).
  // Both business and staff open all day so the window spans the overlap.
  const slots = computeAvailability(
    input({
      now: Date.parse("2026-10-24T00:00:00+03:00"),
      business: {
        leadTimeMinutes: 0,
        horizonDays: 2,
        weekly: everyDay(hm(0), hm(23, 59)),
      },
      staff: [staff("s1", ["cut"], { weekly: everyDay(hm(0), hm(23, 59)) })],
      services: [service("cut", 15)],
    }),
  );
  const starts = new Set(
    slots
      .filter((s) => s.date === "2026-10-25")
      .map((s) => localTime(s.start, SOFIA)),
  );

  assert.ok(starts.has("02:45"));
  assert.ok(starts.has("04:00"));
  for (const ambiguous of ["03:00", "03:15", "03:30", "03:45"]) {
    assert.ok(!starts.has(ambiguous), `${ambiguous} should be excluded`);
  }
});
