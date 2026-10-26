import assert from "node:assert/strict";
import { test } from "node:test";

import { createDemoSalon, serviceTotals } from "@/app/_lib/booking/fixtures";
import { localStart } from "@/app/_lib/booking/time";

test("the fictional catalog has distinct competencies, integer prices and trailing buffers", () => {
  const salon = createDemoSalon(() => Date.parse("2026-06-01T08:00:00Z"));
  assert.equal(salon.name, "Студио за красота Нюанс");
  assert.ok(salon.services.length >= 3);
  assert.ok(salon.staff.length >= 2);
  assert.equal(
    new Set(salon.services.map((service) => service.id)).size,
    salon.services.length,
  );
  assert.equal(
    new Set(salon.staff.map((staff) => staff.id)).size,
    salon.staff.length,
  );

  for (const service of salon.services) {
    // Prices are positive integers, except services settled on site (null).
    assert.ok(
      service.priceCents === null ||
        (Number.isSafeInteger(service.priceCents) && service.priceCents > 0),
    );
    assert.ok(service.durationMinutes > 0);
    assert.ok(service.cleanupMinutes > 0);
    assert.ok(service.category.length > 0);
    assert.ok(
      salon.staff.some((staff) => staff.serviceIds.includes(service.id)),
    );
  }

  for (const staff of salon.staff) {
    assert.ok(
      staff.serviceIds.every((id) =>
        salon.services.some((service) => service.id === id),
      ),
    );
  }

  assert.ok(
    salon.staff.some(
      (staff) =>
        staff.serviceIds.includes("cut_m") &&
        staff.serviceIds.includes("blowdry"),
    ),
  );
  assert.equal(
    salon.staff.filter((staff) =>
      ["cut_m", "massage_relax"].every((id) => staff.serviceIds.includes(id)),
    ).length,
    0,
  );
});

test("service totals sum client duration, then cleanup, and ignore selection order and duplicates", () => {
  const { services } = createDemoSalon(() => 0);
  const selected = services.filter((service) =>
    ["cut_w", "cut_m"].includes(service.id),
  );
  const expected = {
    priceCents: 4600,
    hasVariablePrice: false,
    durationMinutes: 75,
    cleanupMinutes: 20,
  };
  assert.deepEqual(serviceTotals(selected), expected);
  assert.deepEqual(serviceTotals([...selected].reverse()), expected);
  assert.deepEqual(serviceTotals([...selected, ...selected]), expected);
  assert.deepEqual(serviceTotals([]), {
    priceCents: 0,
    hasVariablePrice: false,
    durationMinutes: 0,
    cleanupMinutes: 0,
  });

  // A service settled on site adds its duration but no amount, and flags the total.
  const withVariable = services.filter((service) =>
    ["cut_w", "keratin"].includes(service.id),
  );
  assert.deepEqual(serviceTotals(withVariable), {
    priceCents: 2800,
    hasVariablePrice: true,
    durationMinutes: 135,
    cleanupMinutes: 25,
  });
});

test("walkthrough occupancy and dated closure follow the injected Sofia date, not a fixed demo year", () => {
  for (const [now, expectedToday, nextMonday, closure] of [
    ["2026-12-31T22:30:00Z", "2027-01-01", "2027-01-04", "2027-01-05"],
    ["2026-03-28T22:30:00Z", "2026-03-29", "2026-03-30", "2026-03-31"],
    ["2030-10-26T22:30:00Z", "2030-10-27", "2030-10-28", "2030-10-29"],
    ["2026-06-01T08:00:00Z", "2026-06-01", "2026-06-08", "2026-06-09"],
  ]) {
    let clockReads = 0;
    const salon = createDemoSalon(() => {
      clockReads += 1;

      return Date.parse(now);
    });
    assert.equal(clockReads, 1);
    assert.equal(salon.today, expectedToday);
    assert.equal(salon.exceptions[0].date, closure);
    assert.deepEqual(salon.exceptions[0].hours, []);
    assert.deepEqual(salon.occupied.slice(0, 2), [
      {
        staffId: "mimi",
        start: localStart(nextMonday, 600),
        end: localStart(nextMonday, 660),
      },
      {
        staffId: "pavel",
        start: localStart(nextMonday, 690),
        end: localStart(nextMonday, 750),
      },
    ]);
  }
});

test("weekly business and staff schedules include shorter shifts and closed days", () => {
  const salon = createDemoSalon(() => 0);
  assert.deepEqual(salon.hours[0], []);
  assert.notDeepEqual(salon.staff[0].hours, salon.staff[1].hours);

  for (const hours of [
    salon.hours,
    ...salon.staff.map((staff) => staff.hours),
  ]) {
    assert.equal(Object.keys(hours).length, 7);

    for (const intervals of Object.values(hours)) {
      for (const interval of intervals) {
        assert.ok(interval.startMinute >= 0 && interval.endMinute <= 1440);
        assert.ok(interval.startMinute < interval.endMinute);
      }
    }
  }
});

test("independent fixture instances do not share mutable demo session data", () => {
  const first = createDemoSalon(() => 0);
  const second = createDemoSalon(() => 0);
  assert.notEqual(first.occupied, second.occupied);
  assert.notEqual(first.exceptions, second.exceptions);
});
