import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDuration } from "@/app/_lib/duration";

test("duration display preserves Bulgarian minute, hour and mixed labels", () => {
  for (const [minutes, expected] of [
    [0, "0 мин"],
    [1, "1 мин"],
    [45, "45 мин"],
    [59, "59 мин"],
    [60, "1 ч"],
    [61, "1 ч 1 мин"],
    [90, "1 ч 30 мин"],
    [120, "2 ч"],
    [135, "2 ч 15 мин"],
    [1440, "24 ч"],
  ] as const) {
    assert.equal(formatDuration(minutes), expected);
  }
});
