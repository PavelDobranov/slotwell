import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CatalogError,
  MAX_SELECTED_SERVICES,
  validateServiceSelection,
} from "@/server/catalog";

// Characterization baseline for the pure service-selection rule ahead of its
// extraction into a shared module and its separation from catalog transport
// errors (#97). Today the only coverage runs through the /api/staff and
// /api/availability HTTP routes (catalog.db-test.ts), which conflate the rule
// with its transport translation. These direct assertions pin each branch's
// stable code/status/extra fields so the extraction can preserve them exactly.

function rejects(
  raw: string[] | undefined,
  expected: {
    code: string;
    status: number;
    serviceIds?: string[];
    max?: number;
  },
) {
  assert.throws(
    () => validateServiceSelection(raw),
    (error: unknown) => {
      assert.ok(error instanceof CatalogError);
      assert.equal(error.code, expected.code);
      assert.equal(error.status, expected.status);
      assert.deepEqual(error.serviceIds, expected.serviceIds);
      assert.equal(error.max, expected.max);
      return true;
    },
  );
}

test("service selection requires at least one id", () => {
  rejects(undefined, { code: "services_required", status: 400 });
  rejects([], { code: "services_required", status: 400 });
});

test("service selection bounds the count and reports the max", () => {
  const tooMany = Array.from(
    { length: MAX_SELECTED_SERVICES + 1 },
    (_, i) => `svc${i}`,
  );
  rejects(tooMany, {
    code: "too_many_services",
    status: 400,
    max: MAX_SELECTED_SERVICES,
  });
});

test("service selection rejects empty and over-length identifiers", () => {
  rejects(["cut_w", ""], { code: "invalid_service_id", status: 400 });
  rejects(["x".repeat(65)], { code: "invalid_service_id", status: 400 });
});

test("service selection rejects duplicates and lists each repeated id once", () => {
  rejects(["cut_w", "cut_w", "color", "color"], {
    code: "duplicate_services",
    status: 400,
    serviceIds: ["cut_w", "color"],
  });
});

test("valid selection passes through unchanged, preserving order and identity", () => {
  const raw = ["color", "cut_w", "keratin"];
  const result = validateServiceSelection(raw);
  assert.equal(result, raw);
  assert.deepEqual(result, ["color", "cut_w", "keratin"]);
});
