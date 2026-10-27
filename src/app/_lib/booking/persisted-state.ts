// State for the persisted staff-first entry (#61). Deliberately separate from
// the demo `bookingReducer`: this reducer never recomputes fixture availability.
// Qualified staff come from the API; the reducer only reconciles the current
// choice against that server-provided set. It never invents a replacement.

import type { AvailabilityView, SlotView } from "@/app/_lib/booking/api";

export type PersistedStep = "services" | "staff" | "time";
export type SelectedSlot = SlotView & { date: string };

export function availabilitySelectionKey(
  serviceIds: readonly string[],
  staffId: string | null,
): string {
  return JSON.stringify([[...serviceIds].sort(), staffId]);
}

export type PersistedContact = {
  name: string;
  phone: string;
  email: string;
  note: string;
};

export type PersistedState = {
  serviceIds: readonly string[];
  staffId: string | null;
  contact: PersistedContact;
  step: PersistedStep;
  date: string | null;
  slot: SelectedSlot | null;
  notice: string | null;
};

export type PersistedAction =
  | { type: "services"; ids: readonly string[] }
  | { type: "staff"; id: string }
  | { type: "contact"; draft: Partial<PersistedContact> }
  | { type: "edit"; step: PersistedStep }
  // Reconcile the chosen staff against the server's qualified set for the
  // current services; drops an unqualified choice, keeps a still-valid one.
  | {
      type: "qualified-staff";
      serviceIds: readonly string[];
      staffIds: readonly string[];
    }
  | { type: "date"; date: string }
  | { type: "slot"; slot: SelectedSlot; selectionKey: string }
  | {
      type: "availability";
      selectionKey: string;
      days: AvailabilityView["days"];
    }
  | { type: "next" | "back" | "reset" };

export const initialPersistedState: PersistedState = {
  serviceIds: [],
  staffId: null,
  contact: { name: "", phone: "", email: "", note: "" },
  step: "services",
  date: null,
  slot: null,
  notice: null,
};

const stepOrder: readonly PersistedStep[] = ["services", "staff", "time"];

/** Never navigate past a missing explicit choice. */
function unresolvedStep(state: PersistedState): PersistedStep {
  if (state.serviceIds.length === 0) return "services";
  return state.staffId === null ? "staff" : "time";
}

/** Pure transitions. The caller supplies the server's qualified-staff set via a
 * `qualified-staff` action; the reducer preserves valid service/staff choices
 * and entered contact details across every edit and navigation. */
export function persistedReducer(
  state: PersistedState,
  action: PersistedAction,
): PersistedState {
  if (action.type === "reset") {
    return {
      ...initialPersistedState,
      contact: { ...initialPersistedState.contact },
    };
  }
  // Contact edits never disturb selections or navigation.
  if (action.type === "contact") {
    return { ...state, contact: { ...state.contact, ...action.draft } };
  }

  const selectionKey = availabilitySelectionKey(
    state.serviceIds,
    state.staffId,
  );
  if (
    (action.type === "availability" || action.type === "slot") &&
    action.selectionKey !== selectionKey
  )
    return state;
  if (
    action.type === "qualified-staff" &&
    availabilitySelectionKey(action.serviceIds, null) !==
      availabilitySelectionKey(state.serviceIds, null)
  )
    return state;

  const next = { ...state };
  switch (action.type) {
    case "date":
      next.date = action.date;
      if (next.slot && next.slot.date !== action.date) {
        next.slot = null;
        next.notice = "Датата е променена. Изберете час за новата дата.";
      }
      break;
    case "slot":
      next.date = action.slot.date;
      next.slot = action.slot;
      next.notice = null;
      break;
    case "availability": {
      const day = action.days.find(({ date }) => date === next.slot?.date);
      if (
        next.slot &&
        day &&
        !day.slots.some(
          ({ start, end }) =>
            start === next.slot?.start && end === next.slot?.end,
        )
      ) {
        next.slot = null;
        next.notice =
          "Избраният час вече не е наличен за този избор. Изберете друг час. Останалите данни са запазени.";
      }
      break;
    }
    case "services":
      next.serviceIds = [...new Set(action.ids)];
      // No service can qualify anyone; a lingering staff choice is meaningless.
      if (next.serviceIds.length === 0) {
        next.staffId = null;
        next.slot = null;
        next.notice = "Изберете услуги, специалист и час.";
      }
      break;
    case "staff":
      next.staffId = action.id;
      break;
    case "qualified-staff":
      if (next.staffId !== null && !action.staffIds.includes(next.staffId)) {
        next.staffId = null;
        next.slot = null;
        next.notice =
          "Специалистът вече не е подходящ за избраните услуги. Изберете специалист и час.";
      }
      break;
    case "edit":
      next.step = action.step;
      break;
    case "next":
      next.step =
        stepOrder[
          Math.min(stepOrder.indexOf(state.step) + 1, stepOrder.length - 1)
        ];
      break;
    case "back":
      next.step = stepOrder[Math.max(stepOrder.indexOf(state.step) - 1, 0)];
      break;
  }

  // Never let navigation jump past the earliest unresolved choice.
  const unresolved = unresolvedStep(next);
  if (stepOrder.indexOf(next.step) > stepOrder.indexOf(unresolved))
    next.step = unresolved;
  return next;
}
