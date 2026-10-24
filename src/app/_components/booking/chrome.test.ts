import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Stepper } from "@/app/_components/booking/stepper";
import { euros } from "@/app/_lib/booking/format";
import { type BookingPath, stepOrder } from "@/app/_lib/booking/state";

for (const path of ["staff-first", "time-first"] satisfies BookingPath[]) {
  test(`${path}: only completed steps link back and exactly one step is current`, () => {
    const order = stepOrder(path);
    for (const [index, step] of order.entries()) {
      const html = renderToStaticMarkup(
        createElement(Stepper, {
          path,
          step,
          disabled: false,
          onNavigate: () => {},
        }),
      );
      assert.equal((html.match(/<a /g) ?? []).length, index);
      assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
      assert.match(html, new RegExp(`Стъпка ${index + 1} от 4`));
    }
  });

  test(`${path}: pending confirmation exposes no backward links`, () => {
    const html = renderToStaticMarkup(
      createElement(Stepper, {
        path,
        step: "details",
        disabled: true,
        onNavigate: () => {},
      }),
    );
    assert.doesNotMatch(html, /<a /);
    assert.match(html, /aria-current="step"/);
  });
}

test("shared euro formatter retains Bulgarian currency and decimal formatting", () => {
  assert.match(euros.format(3500 / 100), /^35,00\s€$/);
  assert.match(euros.format(0), /^0,00\s€$/);
});
