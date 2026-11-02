import assert from "node:assert/strict";
import test from "node:test";

import { formatPersistedPrice } from "@/app/_features/booking/price";

test("real price formatting preserves variable-price copy and configured currencies", () => {
  assert.equal(
    formatPersistedPrice(null, "EUR"),
    "Цената се уточнява на място",
  );
  for (const currency of ["EUR", "BGN", "GBP", "JPY"]) {
    for (const amount of [0, 12345]) {
      assert.equal(
        formatPersistedPrice(amount, currency),
        new Intl.NumberFormat("bg-BG", { style: "currency", currency }).format(
          amount / 100,
        ),
      );
    }
  }
});
