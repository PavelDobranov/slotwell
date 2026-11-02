import assert from "node:assert/strict";
import test from "node:test";

import { recoveryPermissions } from "@/app/_features/booking/submission/recovery-permissions";
import type { SubmissionSnapshot } from "@/app/_features/booking/submission/submission-controller";

const pending = {
  kind: "pending",
  operationId: "synthetic",
  submitBefore: "synthetic",
  canSubmit: false,
  canRetry: false,
} as const;

test("recovery-only pending focuses notice and forbids same-agreement retry", () => {
  assert.deepEqual(recoveryPermissions(pending, false), {
    needsRecovery: true,
    focusNotice: true,
    canRecover: true,
    canRetry: false,
    canClear: true,
    canOpenConfirmation: false,
  });
  assert.equal(
    recoveryPermissions({ ...pending, canSubmit: true }, false).needsRecovery,
    false,
  );
  assert.equal(
    recoveryPermissions({ ...pending, canRetry: true }, false).canRetry,
    true,
  );
});

test("fenced and committed states preserve safe clear/recovery boundaries", () => {
  const fenced: SubmissionSnapshot["current"] = {
    kind: "fenced",
    operationId: "synthetic",
    code: "intent_storage_unavailable",
    canSubmit: false,
    canRetry: false,
  };
  assert.equal(recoveryPermissions(fenced, false).canRecover, false);
  assert.equal(recoveryPermissions(fenced, false).canClear, true);
  const committed = {
    kind: "committed",
    operationId: "synthetic",
    receipt: null,
  } as const;
  assert.equal(recoveryPermissions(committed, false).canClear, false);
  assert.equal(recoveryPermissions(committed, false).focusNotice, true);
  const withReceipt = {
    ...committed,
    receipt: {
      appointmentId: "synthetic",
      viewToken: "synthetic",
      confirmationExpiresAt: "synthetic",
    },
  };
  assert.equal(
    recoveryPermissions(withReceipt, false).canOpenConfirmation,
    true,
  );
  assert.equal(recoveryPermissions(withReceipt, false).focusNotice, false);
});

test("busy suppresses notice focus, not action visibility; controller flags remain authoritative", () => {
  const current = {
    kind: "unresolved",
    operationId: "synthetic",
    code: "booking_busy",
    canSubmit: false,
    canRetry: true,
  } as const;
  assert.equal(recoveryPermissions(current, true).needsRecovery, false);
  assert.equal(recoveryPermissions(current, true).focusNotice, false);
  assert.equal(recoveryPermissions(current, true).canRetry, true);
  assert.equal(
    recoveryPermissions({ ...current, kind: "rejected" }, false).focusNotice,
    false,
  );
  assert.deepEqual(Object.values(recoveryPermissions(null, false)), [
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
});
