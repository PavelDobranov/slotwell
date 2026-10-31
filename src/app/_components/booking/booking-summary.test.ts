import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BookingSummary } from "@/app/_components/booking/booking-summary";
import { createDemoSalon } from "@/app/_features/demo-booking/fixtures";
import { initialBookingState } from "@/app/_lib/booking/state";

for (const step of ["services", "time", "staff", "details"] as const) {
  test(`${step}: summary uses the reference content and duration format`, () => {
    const salon = createDemoSalon(() => Date.parse("2026-10-24T09:00:00Z"));
    const service = salon.services.find(
      (service) => service.durationMinutes >= 60,
    );
    assert.ok(service);
    const html = renderToStaticMarkup(
      createElement(BookingSummary, {
        salon,
        state: { ...initialBookingState, step, serviceIds: [service.id] },
        confirmed: false,
        action: null,
        onEdit: () => {},
      }),
    );
    assert.match(html, /Плащане на място в салона\./);
    assert.match(html, /Не е избран/);
    assert.doesNotMatch(html, /Предстои — стъпка/);
    assert.doesNotMatch(html, new RegExp(`${service.durationMinutes} мин`));
    assert.match(html, /Общо · /);
  });
}
