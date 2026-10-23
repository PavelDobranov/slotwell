import assert from "node:assert/strict";
import { test } from "node:test";

import { cn } from "@/app/_lib/utils";

test("the TypeScript harness resolves project aliases and conditional classes", () => {
  const selected: boolean = true;

  assert.equal(
    cn("booking-step", { selected, disabled: false }),
    "booking-step selected",
  );
});
