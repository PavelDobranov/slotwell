import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatServicePrice,
  formatTotalPrice,
} from "@/app/_lib/booking/format";

test("compact prices omit whole-euro decimals without rounding fractional amounts", () => {
  assert.match(formatServicePrice(2800, true), /^28\s*€$/);
  assert.match(formatServicePrice(2850, true), /^28,5\s*€$/);
  assert.match(formatServicePrice(2801, true), /^28,01\s*€$/);
  assert.equal(formatServicePrice(null, true), "на място");
  assert.match(formatServicePrice(2800), /^28,00\s*€$/);
});

test("compact totals preserve exact, lower-bound and on-site pricing semantics", () => {
  assert.match(
    formatTotalPrice({ priceCents: 4600, hasVariablePrice: false }, true),
    /^46\s*€$/,
  );
  assert.match(
    formatTotalPrice({ priceCents: 2800, hasVariablePrice: true }, true),
    /^от 28\s*€$/,
  );
  assert.equal(
    formatTotalPrice({ priceCents: 0, hasVariablePrice: true }, true),
    "на място",
  );
  assert.match(
    formatTotalPrice({ priceCents: 4600, hasVariablePrice: false }),
    /^46,00\s*€$/,
  );
});
