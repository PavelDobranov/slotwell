import assert from "node:assert/strict";
import { test } from "node:test";

import { readQualifiedStaff } from "@/server/catalog";
import { ServiceSelectionError } from "@/shared/service-selection";

const invalidSelections = [
  { serviceIds: [], code: "services_required" },
  {
    serviceIds: Array.from({ length: 21 }, (_, index) => `service-${index}`),
    code: "too_many_services",
    max: 20,
  },
  { serviceIds: [""], code: "invalid_service_id" },
  { serviceIds: ["x".repeat(65)], code: "invalid_service_id" },
  {
    serviceIds: ["cut_w", "cut_w"],
    code: "duplicate_services",
    duplicates: ["cut_w"],
  },
];

for (const selection of invalidSelections) {
  test(`direct qualified-staff read rejects ${selection.code} before database access (${selection.serviceIds.length} IDs)`, async () => {
    const db = {
      select() {
        throw new Error("Invalid selection reached database");
      },
    };
    await assert.rejects(
      readQualifiedStaff(db, selection.serviceIds),
      (error) => {
        assert.ok(error instanceof ServiceSelectionError);
        assert.equal(error.code, selection.code);
        assert.equal(error.max, selection.max);
        assert.deepEqual(error.serviceIds, selection.duplicates);
        return true;
      },
    );
  });
}
