import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Stepper } from "@/app/_components/booking/stepper";
import { euros } from "@/app/_features/demo-booking/format";
import {
  type BookingPath,
  initialBookingState,
  stepOrder,
} from "@/app/_lib/booking/state";

for (const path of ["staff-first", "time-first"] satisfies BookingPath[]) {
  test(`${path}: only completed steps link back and exactly one step is current`, () => {
    const order = stepOrder(path);
    for (const [index, step] of order.entries()) {
      const html = renderToStaticMarkup(
        createElement(Stepper, {
          state: {
            ...initialBookingState,
            path,
            step,
            serviceIds: ["cut_m"],
            staffId: "pavel",
            start: 1,
          },
          review: false,
          disabled: false,
          onNavigate: () => {},
        }),
      );
      const milestone = index === 3 ? 2 : index === 0 ? 0 : 1;
      assert.equal((html.match(/<a /g) ?? []).length, milestone);
      assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
      assert.match(html, new RegExp(`Стъпка ${milestone + 1} от 4`));
    }
  });

  test(`${path}: pending confirmation exposes no backward links`, () => {
    for (const disabled of [false, true]) {
      const html = renderToStaticMarkup(
        createElement(Stepper, {
          state: {
            ...initialBookingState,
            path,
            step: "details",
            serviceIds: ["cut_m"],
            staffId: "pavel",
            start: 1,
            contact: {
              name: "Demo",
              phone: "0888123456",
              email: "demo@example.com",
              note: "",
            },
          },
          review: true,
          disabled,
          onNavigate: () => {},
        }),
      );
      assert.equal((html.match(/<a /g) ?? []).length, disabled ? 0 : 3);
      assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
      assert.match(html, /Стъпка 4 от 4/);
    }
  });
}

test("shared euro formatter retains Bulgarian currency and decimal formatting", () => {
  assert.match(euros.format(3500 / 100), /^35,00\s€$/);
  assert.match(euros.format(0), /^0,00\s€$/);
});
