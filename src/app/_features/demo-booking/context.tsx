"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  availableSlots,
  qualifiedStaff,
} from "@/app/_features/demo-booking/availability";
import {
  createDemoSalon,
  serviceTotals,
} from "@/app/_features/demo-booking/fixtures";
import { createDemoSession } from "@/app/_features/demo-booking/session";
import {
  addCalendarDays,
  businessDateAt,
  formatBusinessTime,
} from "@/app/_features/demo-booking/time";
import type {
  DemoSalon,
  OccupiedInterval,
} from "@/app/_features/demo-booking/types";
import type { GuestContactDraft } from "@/shared/guest-contact";

export type BookingPath = "staff-first" | "time-first";
export type BookingStep = "services" | "staff" | "time" | "details";
export type ContactDraft = GuestContactDraft;
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
  | { type: "next" | "back" | "refresh" | "conflict" | "new-booking" };

type DemoBookingTransitionInputs = {
  salon: DemoSalon;
  now: number;
  sessionOccupied?: readonly OccupiedInterval[];
};

export const initialBookingState: BookingState = {
  serviceIds: [],
  path: "time-first",
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
  context: DemoBookingTransitionInputs,
): BookingState {
  if (action.type === "new-booking")
    return {
      ...initialBookingState,
      contact: { ...initialBookingState.contact },
    };
  const next = { ...state, notice: "" };
  const notices: string[] = [];
  switch (action.type) {
    case "conflict":
      next.start = null;
      next.step = "time";
      notices.push("Избраният час вече не е свободен. Избери друг час.");
      break;
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

type DemoBookingValue = {
  state: BookingState;
  salon: DemoSalon | null;
  availabilityTime: number | null;
  sessionOccupied: readonly OccupiedInterval[] | undefined;
  pending: boolean;
  confirmed: boolean;
  reviewRequested: boolean;
  pathSwitched: boolean;
  confirmationError: string;
  dispatch: (action: BookingAction) => void;
  setReviewRequested: (requested: boolean) => void;
  confirm: () => Promise<void>;
  newBooking: () => void;
};

export const DemoBookingContext = createContext<DemoBookingValue | null>(null);

export function useDemoBooking() {
  const context = useContext(DemoBookingContext);
  if (context === null)
    throw new Error("useDemoBooking must be used within DemoBookingProvider");
  return context;
}

export function DemoBookingProvider({ children }: { children: ReactNode }) {
  const session = useRef<ReturnType<typeof createDemoSession> | null>(null);
  const sessionSalon = useRef<DemoSalon | null>(null);
  const submissionLocked = useRef(false);
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reviewRequested, setReviewRequested] = useState(false);
  const [pathSwitched, setPathSwitched] = useState(false);
  const [confirmationError, setConfirmationError] = useState("");
  // No live dates or fixture bootstrap during server/initial rendering.
  const [salon, setSalon] = useState<DemoSalon | null>(null);
  const [availabilityTime, setAvailabilityTime] = useState<number | null>(null);
  const [state, reduce] = useReducer(
    (
      current: BookingState,
      {
        action,
        inputs,
      }: { action: BookingAction; inputs: DemoBookingTransitionInputs },
    ) => bookingReducer(current, action, inputs),
    initialBookingState,
  );
  function dispatch(action: BookingAction) {
    const now = Date.now();
    // Any explicit edit/navigation requires a fresh contact review. A clock
    // refresh keeps review only while the reducer still has valid choices.
    if (action.type !== "refresh") setReviewRequested(false);
    if (action.type !== "contact") setConfirmationError("");
    if (action.type !== "contact" && action.type !== "refresh")
      setPathSwitched(
        action.type === "path" &&
          action.path !== state.path &&
          (state.start !== null || state.staffId !== null),
      );
    setAvailabilityTime(now);
    if (
      salon !== null &&
      !(submissionLocked.current && action.type === "refresh")
    )
      reduce({
        action,
        inputs: { salon, now, sessionOccupied: session.current?.occupied },
      });
  }
  async function confirm() {
    if (submissionLocked.current || session.current === null) return;
    submissionLocked.current = true;
    setPending(true);
    setConfirmationError("");
    try {
      const result = await session.current.confirm(state);
      if (result === "success") {
        setConfirmed(true);
      } else if (result === "retryable") {
        submissionLocked.current = false;
        setConfirmationError(
          "Нещо прекъсна заявката. Резервацията не е направена и нищо не е загубено. Опитай отново.",
        );
      } else {
        submissionLocked.current = false;
        dispatch({ type: result === "unavailable" ? "conflict" : "refresh" });
        setConfirmationError(
          result === "unavailable"
            ? `${state.start === null ? "Избраният час" : formatBusinessTime(state.start)} вече е зает. Резервацията не е направена. Услугите и данните ти за контакт са запазени. Избери нов час.`
            : "Изборът вече не е валиден. Резервацията не е направена. Данните ти за контакт са запазени. Провери специалиста и часа отново.",
        );
      }
    } catch {
      submissionLocked.current = false;
      setConfirmationError(
        "Нещо прекъсна заявката. Резервацията не е направена и нищо не е загубено. Опитай отново.",
      );
    } finally {
      setPending(false);
    }
  }
  function newBooking() {
    submissionLocked.current = false;
    setConfirmed(false);
    setConfirmationError("");
    dispatch({ type: "new-booking" });
  }
  useEffect(() => {
    // Keep the one-shot bootstrap intact across Strict Mode effect replay.
    if (session.current === null) {
      const now = Date.now();
      const initialSalon = createDemoSalon(() => now);
      sessionSalon.current = initialSalon;
      // Demo/test bootstrap only. Accept one enum, then remove the hook.
      // Never use URLs, storage, or visitor data for scenarios.
      const bootstrap = window as Window & {
        __SLOTWELL_DEMO_SCENARIO__?: unknown;
      };
      const scenario = bootstrap.__SLOTWELL_DEMO_SCENARIO__;
      delete bootstrap.__SLOTWELL_DEMO_SCENARIO__;
      session.current = createDemoSession(
        initialSalon,
        () => Date.now(),
        undefined,
        scenario === "conflict" || scenario === "retryable"
          ? scenario
          : "normal",
      );
      setSalon(initialSalon);
      setAvailabilityTime(now);
    }
    // This effect's snapshot stays anchored to the session; clock/occupancy
    // are sampled before dispatch, never by a replayed reducer.
    const anchoredSalon = sessionSalon.current;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setAvailabilityTime(now);
      if (anchoredSalon !== null && !submissionLocked.current)
        reduce({
          action: { type: "refresh" },
          inputs: {
            salon: anchoredSalon,
            now,
            sessionOccupied: session.current?.occupied,
          },
        });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <DemoBookingContext.Provider
      value={{
        state,
        salon,
        availabilityTime,
        sessionOccupied: session.current?.occupied,
        pending,
        confirmed,
        reviewRequested,
        pathSwitched,
        confirmationError,
        dispatch,
        setReviewRequested,
        confirm,
        newBooking,
      }}
    >
      {children}
    </DemoBookingContext.Provider>
  );
}
