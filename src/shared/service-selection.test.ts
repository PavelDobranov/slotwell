import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_SELECTED_SERVICES,
  ServiceSelectionError,
  validateServiceSelection,
} from "@/shared/service-selection";

// Focused characterization of the pure, transport-independent selection rule.
// These assertions own the policy: each branch's stable code and extras,
// ordering, the count bound (max=20), and the 64-character identifier bound. The
// rule carries no HTTP status; the catalog capability's translation of every
// branch to a 400 is pinned separately with the catalog tests.

function rejects(
  raw: string[] | undefined,
  expected: { code: string; serviceIds?: string[]; max?: number },
) {
  assert.throws(
    () => validateServiceSelection(raw),
    (error: unknown) => {
      assert.ok(error instanceof ServiceSelectionError);
      assert.equal(error.code, expected.code);
      assert.deepEqual(error.serviceIds, expected.serviceIds);
      assert.equal(error.max, expected.max);
      return true;
    },
  );
}

test("the shared count bound is 20", () => {
  assert.equal(MAX_SELECTED_SERVICES, 20);
});

test("service selection requires at least one id", () => {
  rejects(undefined, { code: "services_required" });
  rejects([], { code: "services_required" });
});

test("service selection bounds the count and reports the max", () => {
  const tooMany = Array.from(
    { length: MAX_SELECTED_SERVICES + 1 },
    (_, i) => `svc${i}`,
  );
  rejects(tooMany, { code: "too_many_services", max: MAX_SELECTED_SERVICES });
  // The bound itself is accepted.
  const exactly = Array.from(
    { length: MAX_SELECTED_SERVICES },
    (_, i) => `svc${i}`,
  );
  assert.equal(validateServiceSelection(exactly), exactly);
});

test("service selection rejects empty and over-length identifiers", () => {
  rejects(["cut_w", ""], { code: "invalid_service_id" });
  rejects(["x".repeat(65)], { code: "invalid_service_id" });
  // 64 characters is the inclusive upper bound.
  const maxLength = "x".repeat(64);
  assert.deepEqual(validateServiceSelection([maxLength]), [maxLength]);
});

test("service selection rejects duplicates and lists each repeated id once", () => {
  rejects(["cut_w", "cut_w", "color", "color"], {
    code: "duplicate_services",
    serviceIds: ["cut_w", "color"],
  });
});

test("valid selection passes through unchanged, preserving order and identity", () => {
  const raw = ["color", "cut_w", "keratin"];
  const result = validateServiceSelection(raw);
  assert.equal(result, raw);
  assert.deepEqual(result, ["color", "cut_w", "keratin"]);
});
