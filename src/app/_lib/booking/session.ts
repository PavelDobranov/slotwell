import { availableSlots } from "@/app/_lib/booking/availability";
import type { BookingState } from "@/app/_lib/booking/state";
import { businessDateAt } from "@/app/_lib/booking/time";
import type {
  Clock,
  DemoSalon,
  OccupiedInterval,
} from "@/app/_lib/booking/types";
import { validateContact } from "@/app/_lib/booking/validation";

export type ConfirmationResult =
  | "success"
  | "pending"
  | "invalid"
  | "retryable"
  | "unavailable";

export type DemoScenario = "normal" | "conflict" | "retryable";

/** Replaceable, page-memory-only simulation. It never retains contact data. */
export function createDemoSession(
  salon: DemoSalon,
  clock: Clock,
  wait: () => Promise<void> = () =>
    new Promise((resolve) => setTimeout(resolve, 300)),
  scenario: DemoScenario = "normal",
) {
  let occupied: readonly OccupiedInterval[] = [];
  let pending = false;
  return {
    get occupied() {
      return occupied;
    },
    async confirm(selection: BookingState): Promise<ConfirmationResult> {
      if (pending) return "pending";
      if (
        selection.step !== "details" ||
        selection.start === null ||
        selection.staffId === null ||
        Object.keys(validateContact(selection.contact)).length > 0
      )
        return "invalid";
      pending = true;
      try {
        await wait();
        const slot = availableSlots({
          salon,
          now: clock(),
          serviceIds: selection.serviceIds,
          date: businessDateAt(selection.start),
          staffId: selection.staffId,
          sessionOccupied: occupied,
        }).find(({ start }) => start === selection.start);
        if (!slot) return "unavailable";
        const outcome = scenario;
        scenario = "normal";
        if (outcome === "retryable") return "retryable";
        // A competing demo visitor takes this interval; no contact is retained.
        occupied = [
          ...occupied,
          {
            staffId: selection.staffId,
            start: slot.start,
            end: slot.occupiedEnd,
          },
        ];
        return outcome === "conflict" ? "unavailable" : "success";
      } finally {
        pending = false;
      }
    },
  };
}
