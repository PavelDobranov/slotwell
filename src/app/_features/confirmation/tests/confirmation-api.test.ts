import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fetchConfirmation,
  formatConfirmation,
  parseConfirmationFragment,
} from "@/app/_features/confirmation/confirmation-api";
import type { ConfirmationView } from "@/server/booking";

// Synthetic, non-authorizing credentials only.
const credential = {
  appointmentId: "11111111-1111-4111-8111-111111111111",
  viewToken: "ab".repeat(32),
};
const fragment = `#${new URLSearchParams(credential)}`;
const view: ConfirmationView = {
  status: "confirmed",
  startsAt: "2026-06-01T14:30:00.000Z",
  serviceEndsAt: "2026-06-01T15:15:00.000Z",
  bookingTimeZone: "Asia/Tokyo",
  staffName: "Fictional specialist",
  businessAddress: "Fictional address",
  confirmationExpiresAt: "2026-06-08T15:15:00.000Z",
  services: [
    { name: "Fixed", durationMinutes: 30, priceCents: 2500, currency: "BGN" },
    {
      name: "Variable",
      durationMinutes: 15,
      priceCents: null,
      currency: "BGN",
    },
  ],
};

test("fragment parsing accepts exactly the existing lowercase bearer pair syntax", () => {
  assert.deepEqual(parseConfirmationFragment(fragment), credential);
  for (const hash of [
    "",
    "#invalid",
    "#viewToken=bad",
    `${fragment}&extra=value`,
    `${fragment}&viewToken=${credential.viewToken}`,
    `${fragment}&appointmentId=${credential.appointmentId}`,
    fragment.replace(credential.viewToken, credential.viewToken.toUpperCase()),
    fragment.replace(credential.appointmentId, "not-a-uuid"),
  ])
    assert.equal(parseConfirmationFragment(hash), null);
});

test("transport keeps credentials in POST body and disables cache, credentials, referrers and redirects", async (t) => {
  const controller = new AbortController();
  const response = new Response(null, { status: 404 });
  let called = false;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      called = true;
      assert.equal(url, "/api/confirmations/read");
      assert.equal(options.method, "POST");
      assert.deepEqual(options.headers, { "Content-Type": "application/json" });
      assert.equal(options.body === JSON.stringify(credential), true);
      assert.equal(options.cache, "no-store");
      assert.equal(options.credentials, "omit");
      assert.equal(options.referrerPolicy, "no-referrer");
      assert.equal(options.redirect, "error");
      assert.equal(options.signal, controller.signal);
      return response;
    },
  );
  assert.equal(
    await fetchConfirmation(credential, controller.signal),
    response,
  );
  assert.equal(called, true);
});

test("formatting uses booking-local dates across midnight and the original expiry", () => {
  const display = formatConfirmation(view);
  assert.equal(display.date, "1 юни 2026 г.");
  assert.equal(display.range, "23:30 – 2 юни 2026 г., 00:15");
  assert.equal(display.expiry, "9 юни 2026 г., 00:15");
  assert.equal(display.zone, "Asia/Tokyo");
  assert.equal(display.staff, view.staffName);
  assert.equal(display.address, view.businessAddress);
  assert.deepEqual(
    display.services.map((service) => service.name),
    ["Fixed", "Variable"],
  );
  assert.equal(display.services[0].duration, "30 мин");
  assert.equal(
    display.services[0].price,
    new Intl.NumberFormat("bg-BG", {
      style: "currency",
      currency: "BGN",
    }).format(25),
  );
  assert.equal(display.services[1].price, "Цената се уточнява на място");
});

test("same-day ranges omit a second date; unrendered response fields stay out of display", () => {
  const display = formatConfirmation({
    ...view,
    startsAt: "2026-06-01T23:30:00.000Z",
    serviceEndsAt: "2026-06-02T00:15:00.000Z",
    ...{ contactEmail: "never@example.test", notes: "never render" },
  });
  assert.equal(display.range, "08:30 – 09:15");
  assert.equal("contactEmail" in display, false);
  assert.equal("notes" in display, false);
});

test("invalid snapshots still fail closed before presentation", () => {
  for (const invalid of [
    { ...view, staffName: " " },
    { ...view, businessAddress: " " },
    { ...view, services: [] },
    { ...view, bookingTimeZone: "Invalid/Zone" },
    { ...view, startsAt: "invalid" },
  ])
    assert.throws(() => formatConfirmation(invalid));
});
