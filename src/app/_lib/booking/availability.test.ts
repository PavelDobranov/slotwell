import assert from "node:assert/strict";
import { test } from "node:test";

import {
  availableSlots,
  qualifiedStaff,
} from "@/app/_lib/booking/availability";
import { createDemoSalon } from "@/app/_lib/booking/fixtures";
import { formatBusinessTime, localStart } from "@/app/_lib/booking/time";
import type { DemoSalon } from "@/app/_lib/booking/types";

const date = "2026-01-05";
const now = Date.parse("2026-01-05T06:00:00Z"); // 08:00 Sofia
function instant(minute: number, day = date): number {
  const value = localStart(day, minute);
  assert.notEqual(value, null);

  return value as number;
}
function salon(): DemoSalon {
  const demo = createDemoSalon(() => now);

  return {
    ...demo,
    hours: { ...demo.hours, 1: [{ startMinute: 540, endMinute: 660 }] },
    occupied: [],
    exceptions: [],
  };
}

test("competency requires every distinct known service, including before choosing a time", () => {
  const demo = salon();
  assert.deepEqual(
    qualifiedStaff(demo, ["cut_m"]).map(({ id }) => id),
    ["mila", "ivan"],
  );
  assert.deepEqual(
    qualifiedStaff(demo, ["cut_w", "cut_m", "cut_w"]).map(({ id }) => id),
    ["mila"],
  );

  for (const serviceIds of [
    [],
    ["unknown"],
    ["cut_m", "unknown"],
    ["blowdry", "color"],
  ]) {
    assert.deepEqual(qualifiedStaff(demo, serviceIds), []);
    assert.deepEqual(
      availableSlots({ salon: demo, date, serviceIds, now }),
      [],
    );
  }
});

test("slots intersect business and staff hours, fit cleanup, and deduplicate shared starts", () => {
  const demo = salon();
  const slots = availableSlots({
    salon: demo,
    date,
    serviceIds: ["cut_m"],
    now,
  });
  assert.deepEqual(
    slots.map(({ start }) => start),
    [540, 555, 570, 585, 600, 615].map((minute) => instant(minute)),
  );
  assert.deepEqual(slots[0], {
    start: instant(540),
    end: instant(570),
    occupiedEnd: instant(580),
    staffIds: ["mila", "ivan"],
  });
  const colorSlots = availableSlots({
    salon: demo,
    date,
    serviceIds: ["color"],
    now,
  });
  assert.deepEqual(colorSlots, []); // Elena starts at 10; the 75-minute service cannot fit before 11.
});

test("multi-service duration and summed trailing cleanup are independent of service order", () => {
  const input = { salon: salon(), date, now };
  const slots = availableSlots({ ...input, serviceIds: ["cut_m", "blowdry"] });
  assert.equal(slots.length, 4); // 75 occupied minutes: last grid start is 09:45.
  assert.deepEqual(slots[0], {
    start: instant(540),
    end: instant(600),
    occupiedEnd: instant(615),
    staffIds: ["ivan"],
  });
  assert.deepEqual(
    availableSlots({ ...input, serviceIds: ["blowdry", "cut_m"] }),
    slots,
  );
  assert.deepEqual(
    availableSlots({ ...input, serviceIds: ["blowdry", "cut_m", "blowdry"] }),
    slots,
  );
});

test("dated hours replace weekly hours, while business and staff restrictions both apply", () => {
  const demo: DemoSalon = {
    ...salon(),
    exceptions: [
      { date, hours: [{ startMinute: 600, endMinute: 690 }] },
      { date, staffId: "mila", hours: [{ startMinute: 615, endMinute: 675 }] },
      { date, staffId: "ivan", hours: [] },
    ],
  };
  const slots = availableSlots({
    salon: demo,
    date,
    now,
    serviceIds: ["cut_m"],
  });
  assert.deepEqual(
    slots.map(({ start, staffIds }) => [start, staffIds]),
    [
      [instant(615), ["mila"]],
      [instant(630), ["mila"]],
    ],
  );
  assert.deepEqual(
    availableSlots({
      salon: { ...demo, exceptions: [{ date, hours: [] }] },
      date,
      now,
      serviceIds: ["cut_m"],
    }),
    [],
  );
  assert.deepEqual(
    availableSlots({
      salon: demo,
      date: "2026-01-04",
      now,
      serviceIds: ["cut_m"],
    }),
    [],
  );
});

test("split working windows reject breaks and cleanup overruns but allow exact closing", () => {
  const demo: DemoSalon = {
    ...salon(),
    exceptions: [
      {
        date,
        hours: [
          { startMinute: 540, endMinute: 580 },
          { startMinute: 600, endMinute: 640 },
        ],
      },
    ],
  };
  assert.deepEqual(
    availableSlots({ salon: demo, date, now, serviceIds: ["cut_m"] }).map(
      ({ start }) => start,
    ),
    [instant(540), instant(600)],
  );
});

test("occupied intervals include cleanup, allow touching, and affect only their specialist", () => {
  const demo: DemoSalon = {
    ...salon(),
    occupied: [{ staffId: "mila", start: instant(580), end: instant(600) }],
  };
  const slots = availableSlots({
    salon: demo,
    date,
    now,
    serviceIds: ["cut_m"],
  });
  assert.deepEqual(
    slots.map(({ staffIds }) => staffIds),
    [
      ["mila", "ivan"],
      ["ivan"],
      ["ivan"],
      ["ivan"],
      ["mila", "ivan"],
      ["mila", "ivan"],
    ],
  );
  const sessionOccupied = [
    { staffId: "ivan", start: instant(540), end: instant(580) },
  ];
  const refreshed = availableSlots({
    salon: demo,
    date,
    now,
    serviceIds: ["cut_m"],
    sessionOccupied,
  });
  assert.deepEqual(refreshed[0].staffIds, ["mila"]);
  assert.equal(
    refreshed.some(({ start }) => start === instant(555)),
    false,
  );
  assert.deepEqual(
    refreshed.find(({ start }) => start === instant(585))?.staffIds,
    ["ivan"],
  );
});

test("lead time allows exactly one hour but rejects even one millisecond less", () => {
  const input = { salon: salon(), date, serviceIds: ["cut_m"], now };
  assert.equal(availableSlots(input)[0].start, instant(540));
  assert.equal(
    availableSlots({ ...input, now: now + 1 })[0].start,
    instant(555),
  );
  assert.equal(
    availableSlots({ ...input, now: instant(548) - 60 * 60_000 })[0].start,
    instant(555),
  );
});

test("horizon uses live Sofia today plus 60 calendar days, including closing on the last day across DST", () => {
  const reference = Date.parse("2026-02-28T22:30:00Z"); // March 1 in Sofia
  const demo = {
    ...createDemoSalon(() => reference),
    today: "2020-01-01",
    occupied: [],
    exceptions: [],
  };
  const input = { salon: demo, serviceIds: ["cut_m"], now: reference };
  const lastDay = availableSlots({ ...input, date: "2026-04-30" });
  assert.equal(lastDay.at(-1)?.start, instant(1035, "2026-04-30"));
  assert.equal(lastDay.at(-1)?.occupiedEnd, instant(1075, "2026-04-30"));
  assert.deepEqual(availableSlots({ ...input, date: "2026-05-01" }), []);
  assert.deepEqual(availableSlots({ ...input, date: "2026-02-27" }), []);
  const closed = { ...demo, exceptions: [{ date: "2026-04-30", hours: [] }] };
  assert.deepEqual(
    availableSlots({ ...input, salon: closed, date: "2026-04-30" }),
    [],
  );
});

test("grid is anchored to local midnight, not irregular opening or lead times", () => {
  const demo = {
    ...salon(),
    exceptions: [{ date, hours: [{ startMinute: 547, endMinute: 610 }] }],
  };
  assert.deepEqual(
    availableSlots({ salon: demo, date, now, serviceIds: ["cut_m"] }).map(
      ({ start }) => start,
    ),
    [instant(555), instant(570)],
  );
});

test("nonexistent and ambiguous local starts are absent even with transition-day working hours", () => {
  for (const day of ["2026-03-29", "2026-10-25"]) {
    const reference = Date.parse(`${day}T00:00:00Z`) - 24 * 60 * 60_000;
    const demo = createDemoSalon(() => reference);
    const hours = [{ startMinute: 120, endMinute: 360 }];
    const input = {
      salon: {
        ...demo,
        occupied: [],
        exceptions: [
          { date: day, hours },
          { date: day, staffId: "mila", hours },
        ],
      },
      date: day,
      now: reference,
      serviceIds: ["cut_m"],
      staffId: "mila",
    };
    const slots = availableSlots(input);
    assert.deepEqual(
      slots.map(({ start }) => formatBusinessTime(start)),
      [
        "02:00",
        "02:15",
        "02:30",
        "02:45",
        "04:00",
        "04:15",
        "04:30",
        "04:45",
        "05:00",
        "05:15",
      ],
    );
    assert.equal(new Set(slots.map(({ start }) => start)).size, slots.length);
  }
});

test("unresolvable working boundaries fail closed; midnight closing resolves on the next date", () => {
  const day = "2026-03-29";
  const reference = Date.parse("2026-03-28T00:00:00Z");
  const demo = createDemoSalon(() => reference);

  for (const hours of [
    [{ startMinute: 180, endMinute: 360 }],
    [{ startMinute: 120, endMinute: 210 }],
  ]) {
    assert.deepEqual(
      availableSlots({
        salon: {
          ...demo,
          exceptions: [
            { date: day, hours },
            { date: day, staffId: "mila", hours },
          ],
        },
        date: day,
        now: reference,
        serviceIds: ["cut_m"],
      }),
      [],
    );
  }

  const hours = [{ startMinute: 1380, endMinute: 1440 }];
  const slots = availableSlots({
    salon: {
      ...salon(),
      exceptions: [
        { date, hours },
        { date, staffId: "mila", hours },
      ],
    },
    date,
    now,
    serviceIds: ["cut_m"],
    staffId: "mila",
  });
  assert.deepEqual(
    slots.map(({ start }) => formatBusinessTime(start)),
    ["23:00", "23:15"],
  );
});

test("selectors do not mutate even deeply frozen fixtures, selections, or session occupancy", () => {
  function freeze(value: object) {
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === "object") {
        freeze(child);
      }
    }

    Object.freeze(value);
  }
  const input = {
    salon: salon(),
    date,
    now,
    serviceIds: ["cut_w", "cut_m"],
    sessionOccupied: [
      { staffId: "mila", start: instant(540), end: instant(555) },
    ],
  };
  const before = structuredClone(input);
  freeze(input);
  qualifiedStaff(input.salon, input.serviceIds);
  assert.ok(availableSlots(input).length > 0);
  assert.deepEqual(input, before);
});

test("specialist-first is exactly the matching subset of time-first slots", () => {
  const demo = createDemoSalon(() => now);

  for (const day of [date, "2026-01-12", "2026-01-13", "2026-01-14"]) {
    for (const serviceIds of [
      ["cut_m"],
      ["cut_w", "cut_m"],
      ["blowdry", "color"],
    ]) {
      const input = { salon: demo, date: day, now, serviceIds };
      const combined = availableSlots(input);
      assert.equal(
        new Set(combined.map(({ start }) => start)).size,
        combined.length,
      );

      for (const { id } of demo.staff) {
        assert.deepEqual(
          availableSlots({ ...input, staffId: id }),
          combined
            .filter(({ staffIds }) => staffIds.includes(id))
            .map((slot) => ({ ...slot, staffIds: [id] })),
        );
      }

      assert.deepEqual(availableSlots({ ...input, staffId: "unknown" }), []);
    }
  }
});
