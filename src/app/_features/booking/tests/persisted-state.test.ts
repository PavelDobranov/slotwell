import assert from "node:assert/strict";
import test from "node:test";

import {
  availabilitySelectionKey,
  initialPersistedState,
  type PersistedState,
  persistedReducer,
} from "@/app/_features/booking/state";

const withServices = (ids: string[]): PersistedState =>
  persistedReducer(initialPersistedState, { type: "services", ids });

test("selecting services dedupes and preserves order, advancing to staff", () => {
  const state = withServices(["cut", "color", "cut"]);
  assert.deepEqual(state.serviceIds, ["cut", "color"]);
  assert.equal(
    persistedReducer(state, { type: "next" }).step,
    "staff",
    "services chosen unlocks the staff step",
  );
});

test("staff must be chosen explicitly; the reducer never invents one", () => {
  let state = withServices(["cut"]);
  state = persistedReducer(state, { type: "next" });
  assert.equal(state.staffId, null, "no automatic assignment");
  assert.equal(state.step, "staff");
  state = persistedReducer(state, { type: "staff", id: "mimi" });
  assert.equal(state.staffId, "mimi");
});

test("qualified-staff reconcile keeps a still-valid choice and drops an invalid one", () => {
  let state = persistedReducer(withServices(["cut"]), {
    type: "staff",
    id: "mimi",
  });
  // Still qualified for the (possibly changed) service set: preserved.
  state = persistedReducer(state, {
    type: "qualified-staff",
    serviceIds: ["cut"],
    staffIds: ["mimi", "ivo"],
  });
  assert.equal(state.staffId, "mimi");
  // No longer in the qualified set: dropped, not replaced.
  state = persistedReducer(state, {
    type: "qualified-staff",
    serviceIds: ["cut"],
    staffIds: ["ivo"],
  });
  assert.equal(state.staffId, null);
});

test("editing back to services preserves the staff choice and contact details", () => {
  let state = withServices(["cut"]);
  state = persistedReducer(state, {
    type: "contact",
    draft: { name: "Аня", phone: "0888123456" },
  });
  state = persistedReducer(state, { type: "staff", id: "mimi" });
  state = persistedReducer(state, { type: "edit", step: "services" });

  assert.equal(state.step, "services");
  assert.equal(state.staffId, "mimi", "a valid staff choice survives the edit");
  assert.equal(state.contact.name, "Аня");
  assert.equal(state.contact.phone, "0888123456");
});

test("contact edits merge and never disturb selections or step", () => {
  let state = persistedReducer(withServices(["cut"]), { type: "next" });
  state = persistedReducer(state, { type: "staff", id: "mimi" });
  state = persistedReducer(state, {
    type: "contact",
    draft: { email: "a@b.bg" },
  });
  state = persistedReducer(state, {
    type: "contact",
    draft: { note: "без лак" },
  });

  assert.deepEqual(state.contact, {
    name: "",
    phone: "",
    email: "a@b.bg",
    note: "без лак",
  });
  assert.deepEqual(state.serviceIds, ["cut"]);
  assert.equal(state.staffId, "mimi");
  assert.equal(state.step, "staff");
});

test("clearing all services drops the staff choice and clamps to services", () => {
  let state = persistedReducer(withServices(["cut"]), {
    type: "staff",
    id: "mimi",
  });
  state = persistedReducer(state, { type: "services", ids: [] });
  assert.deepEqual(state.serviceIds, []);
  assert.equal(state.staffId, null);
  assert.equal(
    state.step,
    "services",
    "cannot linger on staff without services",
  );
});

test("navigation never jumps past the earliest unresolved choice", () => {
  // next from services without a selection stays on services.
  assert.equal(
    persistedReducer(initialPersistedState, { type: "next" }).step,
    "services",
  );
  // edit to staff without services is clamped back to services.
  assert.equal(
    persistedReducer(initialPersistedState, { type: "edit", step: "staff" })
      .step,
    "services",
  );
});

test("reset returns a fresh state with an independent contact object", () => {
  let state = persistedReducer(withServices(["cut"]), {
    type: "contact",
    draft: { name: "Аня" },
  });
  state = persistedReducer(state, { type: "reset" });
  assert.deepEqual(state, initialPersistedState);
  assert.notEqual(state.contact, initialPersistedState.contact);
});

const chosenSlot = {
  date: "2026-10-25",
  start: "2026-10-25T00:15:00Z",
  end: "2026-10-25T00:52:00Z",
};
const selectionKey = availabilitySelectionKey(["cut"], "mimi");
function withSlot(): PersistedState {
  let state = persistedReducer(withServices(["cut"]), {
    type: "staff",
    id: "mimi",
  });
  state = persistedReducer(state, { type: "date", date: chosenSlot.date });
  return persistedReducer(state, {
    type: "slot",
    slot: chosenSlot,
    selectionKey,
  });
}

test("time step requires explicit staff and keeps arbitrary server slots without fixture filtering", () => {
  assert.equal(
    persistedReducer(withServices(["cut"]), { type: "edit", step: "time" })
      .step,
    "staff",
  );
  const state = withSlot();
  assert.deepEqual(state.slot, chosenSlot);
  assert.equal(
    persistedReducer(state, { type: "edit", step: "time" }).step,
    "time",
  );
});

test("matching snapshots preserve a slot, but changed end clears only the time with an explanation", () => {
  const state = persistedReducer(withSlot(), {
    type: "contact",
    draft: { name: "Аня" },
  });
  const valid = persistedReducer(state, {
    type: "availability",
    selectionKey,
    days: [{ date: chosenSlot.date, slots: [chosenSlot] }],
  });
  assert.deepEqual(valid.slot, chosenSlot);
  const changed = persistedReducer(valid, {
    type: "availability",
    selectionKey,
    days: [
      {
        date: chosenSlot.date,
        slots: [{ ...chosenSlot, end: "2026-10-25T01:00:00Z" }],
      },
    ],
  });
  assert.equal(changed.slot, null);
  assert.equal(changed.date, chosenSlot.date);
  assert.equal(changed.staffId, "mimi");
  assert.deepEqual(changed.serviceIds, ["cut"]);
  assert.equal(changed.contact.name, "Аня");
  assert.ok(changed.notice);
});

test("out-of-order query and staff responses cannot invalidate current choices", () => {
  const state = withSlot();
  assert.deepEqual(
    persistedReducer(state, {
      type: "availability",
      selectionKey: availabilitySelectionKey(["old"], "mimi"),
      days: [{ date: chosenSlot.date, slots: [] }],
    }),
    state,
  );
  assert.deepEqual(
    persistedReducer(state, {
      type: "qualified-staff",
      serviceIds: ["old"],
      staffIds: [],
    }),
    state,
  );
  assert.deepEqual(
    persistedReducer(state, {
      type: "slot",
      selectionKey: "old",
      slot: chosenSlot,
    }),
    state,
  );
});

test("paging and edits retain tentative selections until their date is revalidated", () => {
  let state = withSlot();
  state = persistedReducer(state, {
    type: "availability",
    selectionKey,
    days: [{ date: "2026-11-01", slots: [] }],
  });
  assert.deepEqual(
    state.slot,
    chosenSlot,
    "off-page response is not evidence of unavailability",
  );
  state = persistedReducer(state, { type: "services", ids: ["cut", "color"] });
  assert.deepEqual(state.slot, chosenSlot);
  state = persistedReducer(state, {
    type: "availability",
    selectionKey: availabilitySelectionKey(state.serviceIds, state.staffId),
    days: [{ date: chosenSlot.date, slots: [] }],
  });
  assert.equal(state.slot, null);
});

const reviewedService = {
  id: "cut",
  name: "Подстригване",
  priceCents: 2000,
  currency: "JPY",
  durationMinutes: 37,
  cleanupMinutes: 10,
};
function withReview(): PersistedState {
  let state = persistedReducer(withSlot(), {
    type: "contact",
    draft: { name: "Test", phone: "09012345678", email: "test@example.test" },
  });
  state = persistedReducer(state, {
    type: "catalog",
    services: [reviewedService],
  });
  state = persistedReducer(state, {
    type: "availability",
    selectionKey,
    days: [{ date: chosenSlot.date, slots: [chosenSlot] }],
  });
  state = persistedReducer(state, { type: "edit", step: "details" });
  return persistedReducer(state, {
    type: "review",
    services: [reviewedService],
    defaultPhoneCountry: "JP",
  });
}

test("details require a slot validated for the current selection; still-valid slots survive revalidation", () => {
  assert.equal(
    persistedReducer(withServices(["cut"]), { type: "edit", step: "details" })
      .step,
    "staff",
  );
  assert.equal(
    persistedReducer(withSlot(), { type: "edit", step: "details" }).step,
    "details",
  );
  const changed = persistedReducer(withSlot(), {
    type: "services",
    ids: ["cut", "color"],
  });
  assert.deepEqual(changed.slot, chosenSlot);
  assert.equal(
    persistedReducer(changed, { type: "edit", step: "details" }).step,
    "time",
  );
  const revalidated = persistedReducer(changed, {
    type: "availability",
    selectionKey: availabilitySelectionKey(changed.serviceIds, changed.staffId),
    days: [{ date: chosenSlot.date, slots: [chosenSlot] }],
  });
  assert.equal(
    persistedReducer(revalidated, { type: "edit", step: "details" }).step,
    "details",
  );
});

test("review validates configured country, snapshots authoritative service consent, and requires explicit renewal after edits", () => {
  const state = withReview();
  assert.equal(state.step, "review");
  assert.equal(state.contact.phoneCountry, "JP");
  assert.deepEqual(state.reviewedServices, [reviewedService]);
  assert.notEqual(state.reviewedServices?.[0], reviewedService);
  const contactEdit = persistedReducer(state, {
    type: "contact",
    draft: { note: "Changed" },
  });
  assert.equal(contactEdit.step, "details");
  assert.equal(contactEdit.reviewedServices, null);
  const back = persistedReducer(state, { type: "back" });
  assert.equal(back.step, "details");
  assert.equal(persistedReducer(back, { type: "next" }).step, "details");
  assert.equal(
    persistedReducer(back, { type: "edit", step: "review" }).step,
    "details",
  );
});

test("invalid contacts and missing/changed service agreement cannot reach review", () => {
  const invalid = persistedReducer(withSlot(), {
    type: "review",
    services: [reviewedService],
    defaultPhoneCountry: "JP",
  });
  assert.notEqual(invalid.step, "review");
  const state = withReview();
  const missing = persistedReducer(state, {
    type: "review",
    services: [],
    defaultPhoneCountry: "JP",
  });
  assert.equal(missing.step, "details");
  assert.equal(missing.reviewedServices, null);
  assert.deepEqual(missing.contact, state.contact);
});

test("conflict clears only the invalid time; catalog review requires consent again; other failures preserve selections", () => {
  const state = withReview();
  const conflict = persistedReducer(state, {
    type: "submission-rejected",
    code: "availability_conflict",
  });
  assert.equal(conflict.step, "time");
  assert.equal(conflict.slot, null);
  assert.deepEqual(conflict.contact, state.contact);
  assert.deepEqual(conflict.serviceIds, state.serviceIds);
  assert.equal(conflict.staffId, state.staffId);
  const review = persistedReducer(state, {
    type: "submission-rejected",
    code: "review_required",
  });
  assert.equal(review.step, "time");
  assert.equal(
    review.slotSelectionKey,
    null,
    "changed catalog needs authoritative time revalidation, not a fabricated replacement",
  );
  assert.deepEqual(review.slot, state.slot);
  assert.equal(review.reviewedServices, null);
  assert.deepEqual(
    persistedReducer(state, {
      type: "submission-rejected",
      code: "unknown_outcome",
    }),
    state,
  );
  assert.deepEqual(
    persistedReducer(state, {
      type: "submission-rejected",
      code: "booking_busy",
    }),
    state,
  );
});

test("catalog reconciliation removes only unavailable services and preserves entered contacts", () => {
  const state = withReview();
  const unchanged = persistedReducer(state, {
    type: "catalog",
    services: [reviewedService, { ...reviewedService, id: "color" }],
  });
  assert.equal(unchanged, state);
  const changed = persistedReducer(state, {
    type: "catalog",
    services: [{ ...reviewedService, id: "color" }],
  });
  assert.deepEqual(changed.serviceIds, []);
  assert.equal(changed.step, "services");
  assert.equal(changed.reviewedServices, null);
  assert.deepEqual(changed.contact, state.contact);
  assert.equal(changed.staffId, null);
});

test("catalog duration or cleanup changes during details require a fresh authoritative slot snapshot", () => {
  const state = persistedReducer(withReview(), {
    type: "edit",
    step: "details",
  });
  const changed = persistedReducer(state, {
    type: "catalog",
    services: [{ ...reviewedService, cleanupMinutes: 20 }],
  });
  assert.equal(changed.step, "time");
  assert.deepEqual(
    changed.slot,
    state.slot,
    "keep tentative choice, do not invent replacement",
  );
  assert.notEqual(changed.slotTimingKey, changed.catalogTimingKey);
  assert.equal(
    persistedReducer(changed, {
      type: "availability",
      selectionKey,
      catalogTimingKey: state.catalogTimingKey,
      days: [{ date: chosenSlot.date, slots: [chosenSlot] }],
    }),
    changed,
    "stale pre-catalog response cannot revalidate",
  );
  const revalidated = persistedReducer(changed, {
    type: "availability",
    selectionKey,
    catalogTimingKey: changed.catalogTimingKey,
    days: [{ date: chosenSlot.date, slots: [chosenSlot] }],
  });
  assert.equal(persistedReducer(revalidated, { type: "next" }).step, "details");
});

test("changing date clears incompatible time; identical date preserves it", () => {
  const state = withSlot();
  assert.deepEqual(
    persistedReducer(state, { type: "date", date: chosenSlot.date }).slot,
    chosenSlot,
  );
  const next = persistedReducer(state, { type: "date", date: "2026-10-26" });
  assert.equal(next.slot, null);
  assert.ok(next.notice);
});
