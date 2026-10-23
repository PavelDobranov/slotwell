import {
  availableSlots,
  qualifiedStaff,
} from "@/app/_lib/booking/availability";
import { serviceTotals } from "@/app/_lib/booking/fixtures";
import { addCalendarDays, businessDateAt } from "@/app/_lib/booking/time";
import type { DemoSalon, OccupiedInterval } from "@/app/_lib/booking/types";

export type BookingPath = "staff-first" | "time-first";
export type BookingStep = "services" | "staff" | "time" | "details";
export type ContactDraft = {
  name: string;
  phone: string;
  email: string;
  note: string;
};
export type BookingState = {
  serviceIds: readonly string[];
  path: BookingPath;
  step: BookingStep;
  staffId: string | null;
  start: number | null;
  date: string | null;
  contact: ContactDraft;
  notice: string;
};
export type BookingAction =
  | { type: "services"; ids: readonly string[] }
  | { type: "path"; path: BookingPath }
  | { type: "staff"; id: string }
  | { type: "time"; start: number }
  | { type: "date"; date: string }
  | { type: "contact"; draft: Partial<ContactDraft> }
  | { type: "edit"; step: BookingStep }
  | { type: "next" | "back" | "refresh" | "new-booking" };

type BookingContext = {
  salon: DemoSalon;
  now: number;
  sessionOccupied?: readonly OccupiedInterval[];
};

export const initialBookingState: BookingState = {
  serviceIds: [],
  path: "staff-first",
  step: "services",
  staffId: null,
  start: null,
  date: null,
  contact: { name: "", phone: "", email: "", note: "" },
  notice: "",
};

export function selectedTotals(state: BookingState, salon: DemoSalon) {
  return serviceTotals(
    salon.services.filter(({ id }) => state.serviceIds.includes(id)),
  );
}

export function stepOrder(path: BookingPath): BookingStep[] {
  return path === "staff-first"
    ? ["services", "staff", "time", "details"]
    : ["services", "time", "staff", "details"];
}

/** Pure transitions; the caller supplies the current clock and session occupancy.
 * Never invent a replacement staff member or start when a choice becomes invalid.
 */
export function bookingReducer(
  state: BookingState,
  action: BookingAction,
  context: BookingContext,
): BookingState {
  if (action.type === "new-booking")
    return {
      ...initialBookingState,
      contact: { ...initialBookingState.contact },
    };
  const next = { ...state, notice: "" };
  const notices: string[] = [];
  switch (action.type) {
    case "services":
      next.serviceIds = [...new Set(action.ids)].filter((id) =>
        context.salon.services.some((service) => service.id === id),
      );
      break;
    case "staff":
      next.staffId = action.id;
      break;
    case "time":
      next.start = action.start;
      next.date = businessDateAt(action.start);
      break;
    case "date":
      next.date = action.date;
      if (next.start !== null && businessDateAt(next.start) !== action.date) {
        next.start = null;
        notices.push("Датата е променена. Избери час за новата дата.");
      }
      break;
    case "contact":
      return { ...state, contact: { ...state.contact, ...action.draft } };
    case "path":
      next.path = action.path;
      break;
  }

  const today = businessDateAt(context.now);
  if (
    next.date !== null &&
    (next.date < today || next.date > addCalendarDays(today, 60))
  ) {
    next.date = null;
    notices.push(
      "Датата вече е извън периода за записване. Избери дата отново.",
    );
  }
  if (
    next.staffId !== null &&
    !qualifiedStaff(context.salon, next.serviceIds).some(
      ({ id }) => id === next.staffId,
    )
  ) {
    next.staffId = null;
    notices.push(
      "Избраният специалист е премахнат, защото не изпълнява всички услуги. Избери специалист отново.",
    );
  }
  if (next.start !== null) {
    const slots = availableSlots({
      ...context,
      serviceIds: next.serviceIds,
      date: businessDateAt(next.start),
      staffId:
        next.path === "staff-first" ? (next.staffId ?? undefined) : undefined,
    });
    const slot = slots.find(({ start }) => start === next.start);
    if (!slot) {
      next.start = null;
      notices.push(
        "Избраният час е премахнат, защото вече не е свободен за тези услуги. Избери час отново.",
      );
    } else if (next.staffId !== null && !slot.staffIds.includes(next.staffId)) {
      next.staffId = null;
      notices.push(
        "Избраният специалист не е свободен за цялото посещение в този час. Избери специалист отново.",
      );
    }
  }
  next.notice =
    notices.length === 0 && action.type === "refresh"
      ? state.notice
      : notices.join(" ");
  const order = stepOrder(next.path);
  const unresolved =
    order.find(
      (step) =>
        (step === "services" && next.serviceIds.length === 0) ||
        (step === "staff" && next.staffId === null) ||
        (step === "time" && next.start === null),
    ) ?? "details";

  if (action.type === "path") next.step = order[1];
  if (action.type === "edit") next.step = action.step;
  if (action.type === "next")
    next.step =
      order[Math.min(order.indexOf(state.step) + 1, order.length - 1)];
  if (action.type === "back")
    next.step = order[Math.max(order.indexOf(state.step) - 1, 0)];
  // Clamp all navigation to the earliest unresolved choice, without jumping forward.
  if (order.indexOf(next.step) > order.indexOf(unresolved))
    next.step = unresolved;
  return next;
}
