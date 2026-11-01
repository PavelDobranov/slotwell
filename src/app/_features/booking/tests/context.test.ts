import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  BookingContext,
  BookingProvider,
  initialPersistedState,
  useBooking,
} from "@/app/_features/booking/context";

function DraftReader() {
  const booking = useBooking();
  assert.equal(useContext(BookingContext), booking);
  assert.deepEqual(booking.state, initialPersistedState);
  assert.equal(typeof booking.dispatch, "function");
  return createElement("output", null, booking.state.step);
}

test("booking hook refuses use outside its scoped provider", () => {
  assert.throws(
    () => renderToStaticMarkup(createElement(DraftReader)),
    /useBooking must be used within BookingProvider/,
  );
});

test("booking provider exposes the draft through its exported context without browser setup during render", () => {
  const client = new QueryClient();
  try {
    assert.equal(
      renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client },
          createElement(BookingProvider, null, createElement(DraftReader)),
        ),
      ),
      "<output>services</output>",
    );
  } finally {
    client.clear();
  }
});
