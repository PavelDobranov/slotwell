import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { qualifiedStaff } from "@/app/_features/demo-booking/availability";
import { createDemoSalon } from "@/app/_features/demo-booking/fixtures";
import {
  businessDateAt,
  businessWeekday,
  localStart,
} from "@/app/_features/demo-booking/time";

test("wellness studio has exactly the requested team and separates hair from massage", () => {
  const salon = createDemoSalon(() => Date.parse("2026-06-01T05:00:00Z"));
  assert.equal(salon.name, "Студио за красота Нюанс");
  assert.equal(salon.services.length, 12);
  assert.equal(
    salon.services.filter(({ category }) => category === "Масажи").length,
    5,
  );
  assert.deepEqual(salon.staff.map(({ name }) => name).sort(), [
    "Емил Стойков",
    "Мими Ибрамова",
    "Павел Добранов",
  ]);
  assert.deepEqual(
    qualifiedStaff(salon, ["cut_m"]).map(({ id }) => id),
    ["mimi", "pavel"],
  );
  for (const member of salon.staff) {
    assert.ok(member.imageUrl?.startsWith("/staff/"));
    assert.ok(existsSync(`public${member.imageUrl}`));
  }
  for (const service of salon.services) {
    const providers = qualifiedStaff(salon, [service.id]);
    assert.ok(providers.length > 0);
    if (service.category === "Масажи") {
      assert.deepEqual(
        providers.map(({ id }) => id),
        ["emil"],
      );
      assert.deepEqual(qualifiedStaff(salon, ["cut_m", service.id]), []);
    } else {
      assert.deepEqual(
        providers.map(({ id }) => id),
        ["mimi", "pavel"],
      );
    }
  }
});

test("both hair specialists support a combined selection of every hair service", () => {
  const salon = createDemoSalon(() => Date.parse("2026-06-01T05:00:00Z"));
  const hairIds = salon.services
    .filter(({ category }) => category === "Коса")
    .map(({ id }) => id);
  assert.equal(hairIds.length, 7);
  assert.deepEqual(
    qualifiedStaff(salon, hairIds).map(({ id }) => id),
    ["mimi", "pavel"],
  );
});

test("rolling visits fit real shifts without overlap across DST and year boundaries", () => {
  for (const now of [
    "2026-06-01T05:00:00Z",
    "2026-03-28T08:00:00Z",
    "2026-10-24T08:00:00Z",
    "2026-12-31T08:00:00Z",
  ]) {
    const salon = createDemoSalon(() => Date.parse(now));
    assert.ok(salon.occupied.length > 20);
    assert.equal(new Set(salon.occupied.map(({ staffId }) => staffId)).size, 3);
    for (const visit of salon.occupied) {
      const member = salon.staff.find(({ id }) => id === visit.staffId);
      assert.ok(member);
      const date = businessDateAt(visit.start);
      assert.equal(businessDateAt(visit.end), date);
      assert.ok(visit.end > visit.start);
      assert.ok(
        !salon.exceptions.some(
          (exception) =>
            exception.date === date && exception.hours.length === 0,
        ),
      );
      for (const hours of [salon.hours, member.hours]) {
        assert.ok(
          hours[businessWeekday(date) as 0 | 1 | 2 | 3 | 4 | 5 | 6].some(
            (window) =>
              visit.start >=
                (localStart(date, window.startMinute) ?? Infinity) &&
              visit.end <= (localStart(date, window.endMinute) ?? -Infinity),
          ),
        );
      }
      assert.ok(
        !salon.occupied.some(
          (other) =>
            other !== visit &&
            other.staffId === visit.staffId &&
            other.start < visit.end &&
            other.end > visit.start,
        ),
      );
    }
  }
});
