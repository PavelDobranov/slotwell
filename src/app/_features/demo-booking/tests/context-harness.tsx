import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { availableSlots } from "@/app/_features/demo-booking/availability";
import {
  DemoBookingProvider,
  useDemoBooking,
} from "@/app/_features/demo-booking/context";
import { createDemoSession } from "@/app/_features/demo-booking/session";
import { businessDateAt } from "@/app/_features/demo-booking/time";

let root: Root;
let current: ReturnType<typeof useDemoBooking>;
let created = 0;
let calls = 0;
let scenarioSeen: unknown;
let release: () => void = () => {};
let renders = 0;
let anchoredSalon: unknown;
const activeTimers = new Set<number>();
const browserWindow: Window = window;
const setInterval = browserWindow.setInterval.bind(window);
const clearInterval = browserWindow.clearInterval.bind(window);
browserWindow.setInterval = (handler, timeout, ...args) => {
  const id = setInterval(handler, timeout, ...args);
  if (timeout === 60_000) activeTimers.add(id);
  return id;
};
browserWindow.clearInterval = (id) => {
  activeTimers.delete(Number(id));
  clearInterval(id);
};

// Only the context's import is replaced by the test bundler. Domain/session
// behavior remains real; the existing wait dependency is held explicitly.
export function createHarnessSession(
  ...args: Parameters<typeof createDemoSession>
) {
  created++;
  scenarioSeen = args[3];
  const session = createDemoSession(
    args[0],
    args[1],
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    args[3],
  );
  return {
    get occupied() {
      return session.occupied;
    },
    confirm: (state: Parameters<typeof session.confirm>[0]) => {
      calls++;
      return session.confirm(state);
    },
  };
}

function Reader() {
  current = useDemoBooking();
  renders++;
  if (current.salon !== null && anchoredSalon === undefined)
    anchoredSalon = current.salon;
  return null;
}

window.demoContextHarness = {
  mount(scenario: unknown) {
    Object.assign(window, { __SLOTWELL_DEMO_SCENARIO__: scenario });
    const container = document.getElementById("root");
    if (container === null) throw new Error("Missing harness root");
    root = createRoot(container);
    root.render(
      <StrictMode>
        <DemoBookingProvider>
          <Reader />
        </DemoBookingProvider>
      </StrictMode>,
    );
  },
  prepare() {
    const salon = current.salon;
    if (salon === null) throw new Error("Demo bootstrap not ready");
    const start = availableSlots({
      salon,
      now: Date.now(),
      date: businessDateAt(Date.now()),
      serviceIds: ["cut_m"],
      staffId: "mimi",
    }).find((slot) => slot.start > Date.now() + 2 * 60 * 60_000)?.start;
    if (start === undefined) throw new Error("No harness slot");
    for (const action of [
      { type: "services", ids: ["cut_m"] },
      { type: "path", path: "staff-first" },
      { type: "staff", id: "mimi" },
      { type: "next" },
      { type: "time", start },
      { type: "next" },
      {
        type: "contact",
        draft: {
          name: "Тест",
          phone: "0888123456",
          email: "test@example.com",
          note: "",
        },
      },
    ] as const)
      current.dispatch(action);
  },
  review() {
    current.dispatch({ type: "refresh" });
    current.setReviewRequested(true);
  },
  confirmTwice() {
    void current.confirm();
    void current.confirm();
  },
  release() {
    release();
  },
  reset() {
    current.newBooking();
  },
  unmount() {
    root.unmount();
  },
  status() {
    return {
      ready: current?.salon !== null && current?.salon !== undefined,
      created,
      activeTimers: activeTimers.size,
      calls,
      scenarioSeen,
      renders,
      hookRemoved: !("__SLOTWELL_DEMO_SCENARIO__" in window),
      anchored: current?.salon === anchoredSalon,
      step: current?.state.step,
      start: current?.state.start,
      pending: current?.pending,
      confirmed: current?.confirmed,
      contactPreserved: current?.state.contact.phone === "0888123456",
      emptyContact: current?.state.contact.phone === "",
      serviceCount: current?.state.serviceIds.length,
      occupiedCount: current?.sessionOccupied?.length ?? 0,
      error: Boolean(current?.confirmationError),
      review: current?.reviewRequested,
      availabilityTime: current?.availabilityTime,
    };
  },
};

declare global {
  interface Window {
    demoContextHarness: {
      mount: (scenario: unknown) => void;
      prepare: () => void;
      review: () => void;
      confirmTwice: () => void;
      release: () => void;
      reset: () => void;
      unmount: () => void;
      status: () => {
        ready: boolean;
        created: number;
        activeTimers: number;
        calls: number;
        scenarioSeen: unknown;
        renders: number;
        hookRemoved: boolean;
        anchored: boolean;
        step: string;
        start: number | null;
        pending: boolean;
        confirmed: boolean;
        contactPreserved: boolean;
        emptyContact: boolean;
        serviceCount: number;
        occupiedCount: number;
        error: boolean;
        review: boolean;
        availabilityTime: number | null;
      };
    };
  }
}
