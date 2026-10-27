import assert from "node:assert/strict";
import test from "node:test";

import {
  availabilitySelectionKey,
  initialPersistedState,
  type PersistedState,
  persistedReducer,
} from "@/app/_lib/booking/persisted-state";

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
