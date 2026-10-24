import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TimeStep } from "@/app/_components/booking/time-step";
import { availableSlots } from "@/app/_lib/booking/availability";
import { createDemoSalon } from "@/app/_lib/booking/fixtures";
import { localStart } from "@/app/_lib/booking/time";

const now = Date.parse("2026-06-01T05:00:00Z");
const availability = {
  salon: createDemoSalon(() => now),
  now,
  serviceIds: ["haircut", "beard"],
  staffId: "ivan",
};
function render(overrides: Partial<Parameters<typeof TimeStep>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(TimeStep, {
      availability,
      start: null,
      selectedDate: "2026-06-01",
      onDate() {},
      onSelect() {},
      onNext() {},
      onEditServices() {},
      onEditStaff() {},
      ...overrides,
    }),
  );
}

test("date strip shows seven dated options with selector counts, today and disabled days", () => {
  const html = render();
  assert.equal((html.match(/name="visit-date"/g) ?? []).length, 7);
  assert.match(html, /днес/);
  assert.match(
    html,
    new RegExp(
      `${availableSlots({ ...availability, date: "2026-06-01" }).length} свободни`,
    ),
  );
  assert.match(
    html,
    /disabled=""[^>]*value="2026-06-03"|value="2026-06-03"[^>]*disabled=""/,
  );
  assert.match(html, /Предишните 7 дни/);
  assert.match(html, /Следващите 7 дни/);
  assert.match(html, /Календар/);
});

test("slot groups and selected range use salon time and exclude cleanup", () => {
  const html = render({ start: localStart("2026-06-01", 900) });
  assert.match(html, /Сутрин/);
  assert.match(html, /След обяд/);
  assert.match(html, /15:00–15:50/);
  assert.match(html, /<output/);
  assert.doesNotMatch(
    render({ start: localStart("2026-06-02", 900) }),
    /15:00–15:50/,
  );
});

test("empty day offers a concrete nearest date, staff and services recovery", () => {
  const html = render({ selectedDate: "2026-06-03" });
  assert.match(html, /Няма свободни часове за тази дата/);
  assert.match(html, /4 юни 2026/);
  assert.match(html, /първи час 09:00/);
  assert.match(html, /Смени специалиста/);
  assert.match(html, /Промени избора на услуги/);
});

test("horizon exhaustion has no invented recovery date", () => {
  const html = render({
    selectedDate: "2026-07-31",
    availability: { ...availability, serviceIds: ["missing"] },
  });
  assert.match(html, /Няма по-късна свободна дата/);
  assert.doesNotMatch(html, /първи час/);
});

test("loading preserves slot grid without selectable stale slots", () => {
  const html = render({ loading: true });
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Търсим свободни часове/);
  assert.equal((html.match(/data-slot="skeleton"/g) ?? []).length, 10);
  assert.doesNotMatch(html, /name="start-time"/);
});
