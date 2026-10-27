import assert from "node:assert/strict";
import test from "node:test";

import {
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
    staffIds: ["mimi", "ivo"],
  });
  assert.equal(state.staffId, "mimi");
  // No longer in the qualified set: dropped, not replaced.
  state = persistedReducer(state, {
    type: "qualified-staff",
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
