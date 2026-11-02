import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import {
  DemoBookingProvider,
  useDemoBooking,
} from "@/app/_features/demo-booking/context";

function Probe() {
  const { state, salon, availabilityTime, pending } = useDemoBooking();
  assert.equal(salon, null);
  assert.equal(availabilityTime, null);
  assert.equal(pending, false);
  assert.equal(state.step, "services");
  assert.deepEqual(state.serviceIds, []);
  return createElement("p", null, state.path);
}

test("demo provider renders without clock sampling or fixture bootstrap on the server", () => {
  assert.match(
    renderToString(
      createElement(DemoBookingProvider, null, createElement(Probe)),
    ),
    /time-first/,
  );
});

test("demo consumer reports a missing provider", () => {
  assert.throws(
    () => renderToString(createElement(Probe)),
    /DemoBookingProvider/,
  );
});
