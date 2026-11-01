// Browser-only test entrypoint. The browser test redirects just the provider's
// binding import to this instrumented factory; the real binding/controller run.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { BookingProvider, useBooking } from "@/app/_features/booking/context";
import type { RetainedBookingIntent } from "@/app/_features/booking/submission/intent-storage";
import { createPersistedSubmission } from "@/app/_features/booking/submission/persisted-submission";

const service = {
  id: "cut",
  name: "Synthetic service",
  category: "Synthetic",
  priceCents: 100,
  currency: "JPY",
  durationMinutes: 30,
  cleanupMinutes: 0,
};
const catalog = {
  business: {
    name: "Synthetic",
    address: "Synthetic",
    timeZone: "Asia/Tokyo",
    currency: "JPY",
    defaultPhoneCountry: "JP",
  },
  services: [service],
};
const pair = {
  operationId: "abcdefab-1111-4111-8111-111111111111",
  credential: "ab".repeat(32),
};
const receipt = {
  appointmentId: "22222222-2222-4222-8222-222222222222",
  viewToken: "cd".repeat(32),
  confirmationExpiresAt: "2030-06-01T12:00:00.000Z",
};
const counts = {
  created: 0,
  disposed: 0,
  subscriptions: 0,
  unsubscribed: 0,
  lists: 0,
  allocations: 0,
  writes: 0,
  resolutions: 0,
  submissions: 0,
  settled: 0,
  renders: 0,
};
let release = () => {};
let held: Promise<void>;
let mode: "discovery" | "allocation" | "submission";
const records: RetainedBookingIntent[] = [];
let locator: string | null = null;
const bindings: ReturnType<typeof createPersistedSubmission>[] = [];
let latest: ReturnType<typeof useBooking> | null = null;
let savedCommands: ReturnType<typeof useBooking>["commands"] | null = null;

export function createHarnessSubmission() {
  const instance = ++counts.created;
  const binding = createPersistedSubmission({
    association: {
      read: () => locator,
      write: (value) => {
        counts.writes++;
        locator = value;
      },
      remove: () => {
        locator = null;
      },
    },
    controller: {
      list: async () => {
        counts.lists++;
        if (mode === "discovery" && instance === 1) {
          await held;
          counts.settled++;
        }
        return records.map((record) => ({ ...record }));
      },
      allocate: async () => {
        counts.allocations++;
        if (mode === "allocation") await held;
        records.push({ ...pair });
        counts.settled++;
        return { ...pair };
      },
      resolve: async () => {
        counts.resolutions++;
        return { state: "pending", submitBefore: "2030-06-01T11:00:00.000Z" };
      },
      submit: async () => {
        counts.submissions++;
        if (mode === "submission") await held;
        counts.settled++;
        return { ...receipt };
      },
    },
  });
  bindings.push(binding);
  return {
    ...binding,
    subscribe(listener: () => void) {
      counts.subscriptions++;
      const unsubscribe = binding.subscribe(listener);
      return () => {
        counts.unsubscribed++;
        unsubscribe();
      };
    },
    dispose() {
      counts.disposed++;
      binding.dispose();
    },
  };
}

function Reader() {
  const booking = useBooking();
  useEffect(() => {
    latest = booking;
    savedCommands = booking.commands;
    counts.renders++;
  });
  return <output>{booking.state.step}</output>;
}
const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
  },
});
client.setQueryData(["catalog"], catalog);
const root = createRoot(document.getElementById("root") as HTMLElement);

const harness = {
  mount(selectedMode: typeof mode) {
    mode = selectedMode;
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
    root.render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <BookingProvider>
            <Reader />
          </BookingProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
  },
  prepareReview() {
    const dispatch = latest?.dispatch;
    if (!dispatch) throw new Error("Harness not ready");
    dispatch({ type: "services", ids: [service.id] });
    dispatch({ type: "staff", id: "mimi" });
    dispatch({ type: "catalog", services: [service] });
    dispatch({
      type: "slot",
      slot: {
        date: "2030-06-01",
        start: "2030-06-01T12:00:00.000Z",
        end: "2030-06-01T12:30:00.000Z",
      },
      selectionKey: JSON.stringify([[service.id], "mimi"]),
    });
    dispatch({
      type: "contact",
      draft: {
        name: "Synthetic",
        phone: "09012345678",
        email: "synthetic@example.test",
        phoneCountry: "JP",
      },
    });
    dispatch({
      type: "review",
      services: [service],
      defaultPhoneCountry: "JP",
    });
  },
  confirmTwice() {
    savedCommands?.confirm();
    savedCommands?.confirm();
  },
  unmount() {
    root.unmount();
    client.clear();
    latest = null;
  },
  release() {
    release();
  },
  status() {
    return {
      ...counts,
      ready: latest?.submission?.ready ?? false,
      busy: latest?.busy ?? false,
      locked: latest?.draftLocked ?? false,
      canConfirm: latest?.canConfirm ?? false,
      cacheOwned: latest?.catalog.data === client.getQueryData(["catalog"]),
      disposedEmpty: bindings
        .slice(0, counts.disposed)
        .every((binding) => binding.getSnapshot().booking.current === null),
    };
  },
};
declare global {
  interface Window {
    bookingHarness: typeof harness;
  }
}
window.bookingHarness = harness;
