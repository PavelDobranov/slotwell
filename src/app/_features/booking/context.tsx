"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  useContext,
  useReducer,
} from "react";

// State for the persisted staff-first entry (#61). Deliberately separate from
// the demo `bookingReducer`: this reducer never recomputes fixture availability.
// Qualified staff come from the API; the reducer only reconciles the current
// choice against that server-provided set. It never invents a replacement.

import type { AvailabilityView, SlotView } from "@/app/_features/booking/api";
import type { BookingAgreement } from "@/app/_features/booking/submission/submission-api";
import {
  type GuestContactDraft,
  parseGuestContact,
} from "@/shared/guest-contact";

export type PersistedStep =
  | "services"
  | "staff"
  | "time"
  | "details"
  | "review";
export type SelectedSlot = SlotView & { date: string; timeZone?: string };

export function availabilitySelectionKey(
  serviceIds: readonly string[],
  staffId: string | null,
): string {
  return JSON.stringify([[...serviceIds].sort(), staffId]);
}

export type PersistedContact = GuestContactDraft;

export type PersistedState = {
  serviceIds: readonly string[];
  staffId: string | null;
  contact: PersistedContact;
  step: PersistedStep;
  date: string | null;
  slot: SelectedSlot | null;
  notice: string | null;
  slotSelectionKey: string | null;
  catalogTimingKey: string | null;
  slotTimingKey: string | null;
  reviewedServices: BookingAgreement["reviewedServices"] | null;
};

export type PersistedAction =
  | { type: "services"; ids: readonly string[] }
  | { type: "catalog"; services: BookingAgreement["reviewedServices"] }
  | { type: "staff"; id: string }
  | { type: "contact"; draft: Partial<PersistedContact> }
  | { type: "edit"; step: PersistedStep }
  | {
      type: "review";
      services: BookingAgreement["reviewedServices"];
      defaultPhoneCountry: string;
    }
  | { type: "submission-rejected"; code: string }
  // Reconcile the chosen staff against the server's qualified set for the
  // current services; drops an unqualified choice, keeps a still-valid one.
  | {
      type: "qualified-staff";
      serviceIds: readonly string[];
      staffIds: readonly string[];
    }
  | { type: "date"; date: string }
  | {
      type: "slot";
      slot: SelectedSlot;
      selectionKey: string;
      catalogTimingKey?: string | null;
    }
  | {
      type: "availability";
      selectionKey: string;
      catalogTimingKey?: string | null;
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
  slotSelectionKey: null,
  catalogTimingKey: null,
  slotTimingKey: null,
  reviewedServices: null,
};

type BookingContextValue = {
  state: PersistedState;
  dispatch: Dispatch<PersistedAction>;
};

export const BookingContext = createContext<BookingContextValue | null>(null);

export function useBooking() {
  const booking = useContext(BookingContext);
  if (!booking)
    throw new Error("useBooking must be used within BookingProvider");
  return booking;
}

export function BookingProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(persistedReducer, initialPersistedState);
  return (
    <BookingContext.Provider value={{ state, dispatch }}>
      {children}
    </BookingContext.Provider>
  );
}

const stepOrder: readonly PersistedStep[] = [
  "services",
  "staff",
  "time",
  "details",
  "review",
];

/** Never navigate past a missing explicit choice. */
function unresolvedStep(state: PersistedState): PersistedStep {
  if (state.serviceIds.length === 0) return "services";
  if (state.staffId === null) return "staff";
  if (
    !state.slot ||
    state.slotSelectionKey !==
      availabilitySelectionKey(state.serviceIds, state.staffId) ||
    state.slotTimingKey !== state.catalogTimingKey
  )
    return "time";
  return state.reviewedServices === null ? "details" : "review";
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
    return {
      ...state,
      contact: { ...state.contact, ...action.draft },
      reviewedServices: null,
      step: state.step === "review" ? "details" : state.step,
    };
  }

  const selectionKey = availabilitySelectionKey(
    state.serviceIds,
    state.staffId,
  );
  if (
    (action.type === "availability" || action.type === "slot") &&
    (action.selectionKey !== selectionKey ||
      (action.catalogTimingKey !== undefined &&
        action.catalogTimingKey !== state.catalogTimingKey))
  )
    return state;
  if (
    action.type === "qualified-staff" &&
    availabilitySelectionKey(action.serviceIds, null) !==
      availabilitySelectionKey(state.serviceIds, null)
  )
    return state;

  const next = { ...state };
  // Every explicit edit needs a new review, even if its resulting values match.
  if (
    ["services", "staff", "date", "slot", "edit", "back"].includes(action.type)
  )
    next.reviewedServices = null;
  switch (action.type) {
    case "catalog": {
      const retained = next.serviceIds.filter((id) =>
        action.services.some((service) => service.id === id),
      );
      const timingKey = JSON.stringify(
        retained.map((id) => {
          const service = action.services.find((service) => service.id === id);
          return [id, service?.durationMinutes, service?.cleanupMinutes];
        }),
      );
      const removed = retained.length !== next.serviceIds.length;
      if (!removed && timingKey === next.catalogTimingKey) return state;
      next.catalogTimingKey = timingKey;
      if (next.slot) next.reviewedServices = null;
      if (removed) {
        next.serviceIds = retained;
        next.reviewedServices = null;
        next.step = "services";
        next.notice =
          "Някои избрани услуги вече не са налични. Валидният избор и данните са запазени.";
        if (retained.length === 0) {
          next.staffId = null;
          next.slot = null;
          next.slotSelectionKey = null;
        }
      }
      break;
    }
    case "review": {
      next.reviewedServices = null;
      next.step = "details";
      const country = next.contact.phoneCountry ?? action.defaultPhoneCountry;
      if (
        parseGuestContact(
          { ...next.contact, phoneCountry: country },
          action.defaultPhoneCountry,
        ).success &&
        action.services.length === next.serviceIds.length &&
        action.services.every(
          (service, index) => service.id === next.serviceIds[index],
        )
      ) {
        next.contact = { ...next.contact, phoneCountry: country };
        next.reviewedServices = action.services.map(
          ({
            id,
            name,
            priceCents,
            currency,
            durationMinutes,
            cleanupMinutes,
          }) => ({
            id,
            name,
            priceCents,
            currency,
            durationMinutes,
            cleanupMinutes,
          }),
        );
        next.step = "review";
        next.notice = null;
      }
      break;
    }
    case "submission-rejected":
      if (
        ![
          "availability_conflict",
          "review_required",
          "selection_unavailable",
          "invalid_contact",
          "invalid_booking",
        ].includes(action.code)
      )
        return state;
      next.reviewedServices = null;
      next.step = "details";
      next.notice =
        "Проверете избора и данните отново. Останалите данни са запазени.";
      if (action.code === "availability_conflict") {
        next.slot = null;
        next.slotSelectionKey = null;
        next.step = "time";
        next.notice =
          "Избраният час вече не е наличен. Изберете друг час. Останалите данни са запазени.";
      } else if (action.code === "review_required") {
        next.slotSelectionKey = null;
        next.step = "time";
      } else if (action.code === "selection_unavailable")
        next.step = "services";
      break;
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
      next.slotSelectionKey = selectionKey;
      next.slotTimingKey = next.catalogTimingKey;
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
        next.slotSelectionKey = null;
        next.reviewedServices = null;
        next.notice =
          "Избраният час вече не е наличен за този избор. Изберете друг час. Останалите данни са запазени.";
      } else if (next.slot && day) {
        next.slotSelectionKey = selectionKey;
        next.slotTimingKey = next.catalogTimingKey;
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
      if (state.step === "details") return state;
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
