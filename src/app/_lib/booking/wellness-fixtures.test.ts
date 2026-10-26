import assert from "node:assert/strict";
import { test } from "node:test";

import { qualifiedStaff } from "@/app/_lib/booking/availability";
import { createDemoSalon } from "@/app/_lib/booking/fixtures";

test("wellness studio has exactly the requested team and separates hair from massage", () => {
  const salon = createDemoSalon(() => Date.parse("2026-06-01T05:00:00Z"));
  assert.equal(salon.name, "Wellness Studio");
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
      assert.ok(providers.every(({ id }) => id !== "emil"));
    }
  }
});
