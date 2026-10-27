// State for the persisted staff-first entry (#61). Deliberately separate from
// the demo `bookingReducer`: this reducer never recomputes fixture availability.
// Qualified staff come from the API; the reducer only reconciles the current
// choice against that server-provided set. It never invents a replacement.

export type PersistedStep = "services" | "staff";

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
};

export type PersistedAction =
  | { type: "services"; ids: readonly string[] }
  | { type: "staff"; id: string }
  | { type: "contact"; draft: Partial<PersistedContact> }
  | { type: "edit"; step: PersistedStep }
  // Reconcile the chosen staff against the server's qualified set for the
  // current services; drops an unqualified choice, keeps a still-valid one.
  | { type: "qualified-staff"; staffIds: readonly string[] }
  | { type: "next" | "back" | "reset" };

export const initialPersistedState: PersistedState = {
  serviceIds: [],
  staffId: null,
  contact: { name: "", phone: "", email: "", note: "" },
  step: "services",
};

const stepOrder: readonly PersistedStep[] = ["services", "staff"];

/** Earliest step whose required choice is still missing; staff is the last step
 * in this slice, so a complete selection still rests there. */
function unresolvedStep(state: PersistedState): PersistedStep {
  if (state.serviceIds.length === 0) return "services";
  return "staff";
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

  const next = { ...state };
  switch (action.type) {
    case "services":
      next.serviceIds = [...new Set(action.ids)];
      // No service can qualify anyone; a lingering staff choice is meaningless.
      if (next.serviceIds.length === 0) next.staffId = null;
      break;
    case "staff":
      next.staffId = action.id;
      break;
    case "qualified-staff":
      if (next.staffId !== null && !action.staffIds.includes(next.staffId))
        next.staffId = null;
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
