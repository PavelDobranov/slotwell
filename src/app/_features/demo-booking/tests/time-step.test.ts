import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availableSlots } from "@/app/_features/demo-booking/availability";
import { createDemoSalon } from "@/app/_features/demo-booking/fixtures";
import { localStart } from "@/app/_features/demo-booking/time";
import { TimeSlots } from "@/app/_features/demo-booking/time-slots";
import { TimeStep } from "@/app/_features/demo-booking/time-step";

const now = Date.parse("2026-06-01T05:00:00Z");
const availability = {
  salon: createDemoSalon(() => now),
  now,
  serviceIds: ["cut_m", "blowdry"],
  staffId: "pavel",
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

test("date strip shows seven dated options with status tags, today and disabled days", () => {
  const html = render();
  assert.equal((html.match(/name="visit-date"/g) ?? []).length, 7);
  assert.match(html, /днес/);
  assert.match(
    html,
    /disabled=""[^>]*value="2026-06-03"|value="2026-06-03"[^>]*disabled=""/,
  );
  assert.match(html, /Предишни дни/);
  assert.match(html, /Следващи дни/);
});

test("Clear Day dates are compact chips with a non-color unavailable treatment", () => {
  const html = render();
  assert.match(html, /h-18/);
  assert.match(html, /has-\[:disabled\]:border-dashed/);
  assert.match(html, /has-\[:checked\]:bg-primary/);
  // Sunday 7 June is a salon rest day inside the opening window.
  assert.match(html, /почивен ден"/);
});

test("slot groups and selected range use salon time and exclude cleanup", () => {
  const html = render({ start: localStart("2026-06-01", 900) });
  assert.match(html, /Сутрин/);
  assert.match(html, /Следобед/);
  assert.match(html, /Избрахте/);
  assert.match(html, /15:00–16:00/);
  assert.doesNotMatch(
    render({ start: localStart("2026-06-02", 900) }),
    /15:00–16:00/,
  );
});

test("slot groups separate Sofia evenings and omit groups with no available starts", () => {
  const slots = availableSlots({
    ...availability,
    serviceIds: ["cut_m"],
    date: "2026-06-01",
  });
  const eveningStart = localStart("2026-06-01", 17 * 60);
  assert.ok(eveningStart !== null);
  const html = renderToStaticMarkup(
    createElement(TimeSlots, {
      slots: slots.filter((slot) => slot.start >= eveningStart),
      date: "2026-06-01",
      start: null,
      onSelect() {},
    }),
  );
  assert.match(html, /Вечер/);
  assert.doesNotMatch(html, /Сутрин|След обяд/);
  assert.equal(
    (html.match(/name="start-time"/g) ?? []).length,
    slots.filter((slot) => slot.start >= eveningStart).length,
  );
  assert.doesNotMatch(html, /checked=""/);
});

test("loading uses the same responsive slot geometry and keeps navigation disabled", () => {
  const html = render({ loading: true });
  assert.match(
    html,
    /grid-cols-2 gap-2 @min-\[20rem\]:grid-cols-4 @min-\[30rem\]:grid-cols-6/,
  );
  assert.match(html, /h-12 rounded-slot/);
  assert.match(html, /<fieldset disabled=""/);
});

test("empty day offers a concrete nearest date, staff and services recovery", () => {
  const html = render({ selectedDate: "2026-06-03" });
  assert.match(html, /Няма свободни часове за тази дата/);
  assert.match(html, /data-slot="alert"[^>]*role="status"/);
  assert.doesNotMatch(html, /name="start-time"/);
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
