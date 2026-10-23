import { serviceTotals } from "@/app/_lib/booking/fixtures";
import {
  addCalendarDays,
  businessDateAt,
  businessWeekday,
  localStart,
} from "@/app/_lib/booking/time";
import type {
  DemoSalon,
  OccupiedInterval,
  WorkingHours,
} from "@/app/_lib/booking/types";

const MINUTE_MS = 60_000;

export type AvailabilityInput = {
  readonly salon: DemoSalon;
  readonly serviceIds: readonly string[];
  readonly date: string;
  /** Epoch milliseconds supplied at the operation boundary, never read globally. */
  readonly now: number;
  readonly staffId?: string;
  /** Additional occupancy from successful demo bookings in this page session. */
  readonly sessionOccupied?: readonly OccupiedInterval[];
};

export type AvailableSlot = {
  readonly start: number;
  /** Client-visible end excludes cleanup; occupiedEnd includes all trailing cleanup. */
  readonly end: number;
  readonly occupiedEnd: number;
  readonly staffIds: readonly string[];
};

/** Qualification only; staff need not have availability on a particular date. */
export function qualifiedStaff(
  salon: DemoSalon,
  serviceIds: readonly string[],
) {
  if (
    serviceIds.length === 0 ||
    serviceIds.some(
      (id) => !salon.services.some((service) => service.id === id),
    )
  )
    return [];
  return salon.staff.filter((staff) =>
    serviceIds.every((id) => staff.serviceIds.includes(id)),
  );
}

function instantHours(date: string, hours: readonly WorkingHours[]) {
  return hours.flatMap(({ startMinute, endMinute }) => {
    const start = localStart(date, startMinute);
    const end =
      endMinute === 1440
        ? localStart(addCalendarDays(date, 1), 0)
        : localStart(date, endMinute);
    return start === null || end === null ? [] : [{ start, end }];
  });
}

/** Shared simulation for both paths: omit staffId for time-first, pass it for
 * specialist-first. Results are chronological, with one entry per local start.
 */
export function availableSlots(input: AvailabilityInput): AvailableSlot[] {
  const { salon, serviceIds, date, staffId, now } = input;
  const weekday = businessWeekday(date) as keyof DemoSalon["hours"];
  const today = businessDateAt(now);
  if (date < today || date > addCalendarDays(today, 60)) return [];
  const hoursFor = (weekly: readonly WorkingHours[], id?: string) =>
    salon.exceptions.find(
      (exception) => exception.date === date && exception.staffId === id,
    )?.hours ?? weekly;
  const businessHours = instantHours(date, hoursFor(salon.hours[weekday]));
  const occupied = [...salon.occupied, ...(input.sessionOccupied ?? [])];
  const staff = qualifiedStaff(salon, serviceIds)
    .filter((member) => staffId === undefined || member.id === staffId)
    .map((member) => ({
      ...member,
      windows: instantHours(date, hoursFor(member.hours[weekday], member.id)),
    }));
  if (staff.length === 0 || businessHours.length === 0) return [];
  const totals = serviceTotals(
    salon.services.filter(({ id }) => serviceIds.includes(id)),
  );
  const slots: AvailableSlot[] = [];
  for (let minute = 0; minute < 1440; minute += 15) {
    const start = localStart(date, minute);
    if (start === null || start < now + 60 * MINUTE_MS) continue;
    const end = start + totals.durationMinutes * MINUTE_MS;
    const occupiedEnd = end + totals.cleanupMinutes * MINUTE_MS;
    const fits = (window: { start: number; end: number }) =>
      start >= window.start && occupiedEnd <= window.end;
    if (!businessHours.some(fits)) continue;
    const staffIds = staff
      .filter(
        ({ id, windows }) =>
          windows.some(fits) &&
          !occupied.some(
            (interval) =>
              interval.staffId === id &&
              start < interval.end &&
              occupiedEnd > interval.start,
          ),
      )
      .map(({ id }) => id);
    if (staffIds.length > 0) slots.push({ start, end, occupiedEnd, staffIds });
  }
  return slots;
}
