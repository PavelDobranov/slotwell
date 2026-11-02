import assert from "node:assert/strict";
import test from "node:test";

import { initialPersistedState } from "@/app/_features/booking/context";
import { draftPermissions } from "@/app/_features/booking/draft-permissions";

const service = {
  id: "cut",
  name: "Тест",
  category: "Коса",
  priceCents: 2000,
  currency: "GBP",
  durationMinutes: 30,
  cleanupMinutes: 5,
};
const { category: _category, ...consent } = service;
const timingKey = JSON.stringify([
  [service.id, service.durationMinutes, service.cleanupMinutes],
]);
const input = {
  state: {
    ...initialPersistedState,
    serviceIds: [service.id],
    reviewedServices: [consent],
    catalogTimingKey: timingKey,
    slotTimingKey: timingKey,
  },
  selectedServices: [service],
  catalogFetching: false,
  catalogError: false,
  submission: {
    ready: true,
    busy: false,
    associationProblem: false,
    booking: {
      activity: null,
      current: null,
      problem: null,
      retainedIds: [],
      disposed: false,
    },
  },
};

test("confirm requires exact ordered consent, current timing and fresh catalog", () => {
  assert.equal(draftPermissions(input).canConfirm, true);
  assert.equal(
    draftPermissions({ ...input, catalogFetching: true }).canConfirm,
    false,
  );
  assert.equal(
    draftPermissions({ ...input, catalogError: true }).canConfirm,
    false,
  );
  assert.equal(
    draftPermissions({
      ...input,
      selectedServices: [{ ...service, priceCents: 2100 }],
    }).reviewMatches,
    false,
  );
  assert.equal(
    draftPermissions({
      ...input,
      state: { ...input.state, reviewedServices: null },
    }).canConfirm,
    false,
  );
  assert.equal(
    draftPermissions({
      ...input,
      state: { ...input.state, slotTimingKey: "old" },
    }).timingCurrent,
    false,
  );
  assert.equal(
    draftPermissions({
      ...input,
      selectedServices: [{ ...service, cleanupMinutes: 10 }],
    }).timingCurrent,
    false,
  );
  assert.equal(
    draftPermissions({ ...input, selectedServices: [] }).canConfirm,
    false,
  );
});

test("draft stays locked until initialization and retained-intent permissions allow editing", () => {
  assert.equal(
    draftPermissions({ ...input, submission: null }).draftLocked,
    true,
  );
  for (const change of [
    { ready: false },
    { busy: true },
    { associationProblem: true },
  ]) {
    assert.equal(
      draftPermissions({
        ...input,
        submission: { ...input.submission, ...change },
      }).draftLocked,
      true,
    );
  }
  assert.equal(
    draftPermissions({
      ...input,
      submission: {
        ...input.submission,
        booking: { ...input.submission.booking, retainedIds: ["synthetic"] },
      },
    }).draftLocked,
    true,
  );
  assert.equal(
    draftPermissions({
      ...input,
      submission: {
        ...input.submission,
        booking: {
          ...input.submission.booking,
          problem: "intent_capacity_reached",
        },
      },
    }).draftLocked,
    true,
  );
  const pending = {
    kind: "pending",
    operationId: "synthetic",
    submitBefore: "synthetic",
    canSubmit: true,
    canRetry: false,
  } as const;
  for (const canSubmit of [true, false]) {
    assert.equal(
      draftPermissions({
        ...input,
        submission: {
          ...input.submission,
          booking: {
            ...input.submission.booking,
            current: { ...pending, canSubmit },
          },
        },
      }).draftLocked,
      !canSubmit,
    );
  }
});
