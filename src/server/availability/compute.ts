// Authoritative booking availability (M1 #64).
//
// A pure, deterministic function over explicit configuration and occupancy
// inputs — no database or UI dependency. The reference instant (`now`) is
// injected at the operation boundary, never read from the global clock, so the
// same inputs always yield the same slots. All wall-clock rules resolve in the
// explicit business zone via the #62 primitives; all instants are epoch
// milliseconds (PostgreSQL `timestamptz`).

import {
  addCalendarDays,
  addElapsedMinutes,
  assertIanaTimeZone,
  BOOKING_GRID_MINUTES,
  businessDate,
  businessWeekday,
  resolveLocalStart,
} from "@/shared/booking-time";

const MINUTE_MS = 60_000;

/** A recurring weekly working window, as local clock minutes-of-day. */
export type WeeklyWindow = {
  /** Local weekday the window recurs on. Sunday = 0 … Saturday = 6. */
  readonly weekday: number;
  /** Opening minute-of-day, inclusive, within [0, 1440). */
  readonly opensMinute: number;
  /** Closing minute-of-day, exclusive, within (opensMinute, 1440). */
  readonly closesMinute: number;
};

/**
 * A dated override that REPLACES a subject's weekly windows for one local date:
 * a closed row shuts the date entirely; open rows carry the replacement windows.
 */
export type ScheduleException =
  | { readonly onDate: string; readonly isClosed: true }
  | {
      readonly onDate: string;
      readonly isClosed: false;
      readonly opensMinute: number;
      readonly closesMinute: number;
    };

/** A half-open [start, end) occupied instant interval (appointment or block). */
export type OccupiedInterval = {
  /** Inclusive start, epoch milliseconds. */
  readonly startInstant: number;
  /** Exclusive end, epoch milliseconds. A slot may start exactly here. */
  readonly endInstant: number;
};

/** Business-wide configuration shared by every staff member. */
export type AvailabilityBusiness = {
  /** IANA business zone; every wall-clock rule resolves here. */
  readonly timeZone: string;
  /** Minimum lead time in minutes; a start at exactly `now + lead` is allowed. */
  readonly leadTimeMinutes: number;
  /** Closing horizon in local calendar days from `now`'s business date, inclusive. */
  readonly horizonDays: number;
  readonly weekly: readonly WeeklyWindow[];
  readonly exceptions: readonly ScheduleException[];
};

/** One staff member's qualifications, working hours and occupied time. */
export type AvailabilityStaff = {
  readonly id: string;
  /** Service ids this staff member is qualified and active to perform. */
  readonly qualifiedServiceIds: readonly string[];
  readonly weekly: readonly WeeklyWindow[];
  readonly exceptions: readonly ScheduleException[];
  readonly occupied: readonly OccupiedInterval[];
};

/** One selected service's timing. Durations and cleanups are elapsed minutes. */
export type SelectedService = {
  readonly id: string;
  readonly durationMinutes: number;
  readonly cleanupMinutes: number;
};

/** Everything needed to compute availability for one selection, deterministically. */
export type AvailabilityInput = {
  /** Reference instant, epoch milliseconds, supplied at the boundary. */
  readonly now: number;
  readonly business: AvailabilityBusiness;
  readonly staff: readonly AvailabilityStaff[];
  /** Selected services, in booking order; all must be qualified for a staff member. */
  readonly services: readonly SelectedService[];
  /** Optional inclusive business-local query bounds; does not alter booking limits. */
  readonly dateRange?: { readonly from: string; readonly to: string };
};

/** An offered start time and the qualified staff free to take it. */
export type AvailableSlot = {
  /** Business-local calendar date of the start. */
  readonly date: string;
  /** Start instant, epoch milliseconds. */
  readonly start: number;
  /** Client-visible end (start + summed durations); excludes trailing cleanup. */
  readonly end: number;
  /** Occupied end (end + summed cleanups); the whole interval must fit and be free. */
  readonly occupiedEnd: number;
  /** Ids of qualified staff free for the whole occupied interval, in input order. */
  readonly staffIds: readonly string[];
};

/** A resolved working window as a half-open [open, close) instant interval. */
type InstantWindow = {
  readonly openInstant: number;
  readonly closeInstant: number;
};

// The windows applicable to a subject on one date: dated exceptions replace the
// weekly schedule; any closed row shuts the date entirely.
function windowsForDate(
  weekly: readonly WeeklyWindow[],
  exceptions: readonly ScheduleException[],
  date: string,
  weekday: number,
): { open: number; close: number }[] {
  const dayExceptions = exceptions.filter((e) => e.onDate === date);

  if (dayExceptions.length > 0) {
    const windows: { open: number; close: number }[] = [];

    for (const exception of dayExceptions) {
      if (exception.isClosed) {
        return [];
      }
      windows.push({
        open: exception.opensMinute,
        close: exception.closesMinute,
      });
    }

    return windows;
  }

  return weekly
    .filter((w) => w.weekday === weekday)
    .map((w) => ({ open: w.opensMinute, close: w.closesMinute }));
}

// All non-empty overlaps between two window sets, in local minute-of-day space.
function intersectWindows(
  a: readonly { open: number; close: number }[],
  b: readonly { open: number; close: number }[],
): { open: number; close: number }[] {
  const out: { open: number; close: number }[] = [];

  for (const x of a) {
    for (const y of b) {
      const open = Math.max(x.open, y.open);
      const close = Math.min(x.close, y.close);

      if (close > open) {
        out.push({ open, close });
      }
    }
  }

  return out;
}

// Resolve minute-of-day windows to instant windows for a date. A window whose
// boundary falls in a DST gap/overlap fails closed (is dropped), per #62.
function toInstantWindows(
  windows: readonly { open: number; close: number }[],
  date: string,
  timeZone: string,
): InstantWindow[] {
  const out: InstantWindow[] = [];

  for (const window of windows) {
    const open = resolveLocalStart(date, window.open, timeZone);
    const close = resolveLocalStart(date, window.close, timeZone);

    if (
      open.kind === "ok" &&
      close.kind === "ok" &&
      close.instant > open.instant
    ) {
      out.push({ openInstant: open.instant, closeInstant: close.instant });
    }
  }

  return out;
}

// Whole [start, occupiedEnd) interval fits inside one open window.
function fitsInWindow(
  windows: readonly InstantWindow[],
  start: number,
  occupiedEnd: number,
): boolean {
  return windows.some(
    (w) => start >= w.openInstant && occupiedEnd <= w.closeInstant,
  );
}

// Half-open overlap: a start touching a previous interval's end is allowed.
function overlapsOccupied(
  occupied: readonly OccupiedInterval[],
  start: number,
  occupiedEnd: number,
): boolean {
  return occupied.some(
    (iv) => start < iv.endInstant && occupiedEnd > iv.startInstant,
  );
}

/**
 * Compute the authoritative available slots for a service selection.
 *
 * A slot is offered when, for at least one qualified staff member, the whole
 * occupied interval (summed durations followed by summed cleanups) fits inside
 * the intersection of business and staff hours for the date and overlaps no
 * occupied time. Starts sit on the 15-minute grid, honour an inclusive lead
 * time, stay within the closing horizon, and exclude DST gap/overlap instants.
 */
export function computeAvailability(input: AvailabilityInput): AvailableSlot[] {
  const { now, business, services } = input;
  const timeZone = business.timeZone;
  assertIanaTimeZone(timeZone);

  if (services.length === 0) {
    return [];
  }

  const selectedIds = services.map((s) => s.id);
  const totalDuration = services.reduce((n, s) => n + s.durationMinutes, 0);
  const totalCleanup = services.reduce((n, s) => n + s.cleanupMinutes, 0);

  if (totalDuration <= 0) {
    return [];
  }

  // All-service qualification: a staff member must cover every selected service.
  const qualified = input.staff.filter((member) => {
    const covered = new Set(member.qualifiedServiceIds);
    return selectedIds.every((id) => covered.has(id));
  });

  if (qualified.length === 0) {
    return [];
  }

  const earliestStart = now + business.leadTimeMinutes * MINUTE_MS;
  const today = businessDate(now, timeZone);
  const horizonDate = addCalendarDays(today, business.horizonDays);
  const firstDate =
    input.dateRange && input.dateRange.from > today
      ? input.dateRange.from
      : today;
  const lastDate =
    input.dateRange && input.dateRange.to < horizonDate
      ? input.dateRange.to
      : horizonDate;

  const slots: AvailableSlot[] = [];

  for (
    let date = firstDate;
    date <= lastDate;
    date = addCalendarDays(date, 1)
  ) {
    const weekday = businessWeekday(date);
    const businessWindows = windowsForDate(
      business.weekly,
      business.exceptions,
      date,
      weekday,
    );

    if (businessWindows.length === 0) {
      continue;
    }

    // Per-staff working windows for the date, intersected with business hours.
    const staffWindows = new Map<string, InstantWindow[]>();

    for (const member of qualified) {
      const effective = intersectWindows(
        businessWindows,
        windowsForDate(member.weekly, member.exceptions, date, weekday),
      );
      const instantWindows = toInstantWindows(effective, date, timeZone);

      if (instantWindows.length > 0) {
        staffWindows.set(member.id, instantWindows);
      }
    }

    if (staffWindows.size === 0) {
      continue;
    }

    for (let minute = 0; minute < 1440; minute += BOOKING_GRID_MINUTES) {
      const resolved = resolveLocalStart(date, minute, timeZone);

      // Exclude starts that never happen or happen twice across a DST change.
      if (resolved.kind !== "ok") {
        continue;
      }

      const start = resolved.instant;

      // Inclusive lead time: a start at exactly now + lead is allowed.
      if (start < earliestStart) {
        continue;
      }

      const end = addElapsedMinutes(start, totalDuration);
      const occupiedEnd =
        totalCleanup > 0 ? addElapsedMinutes(end, totalCleanup) : end;

      const freeStaff: string[] = [];

      for (const member of qualified) {
        const windows = staffWindows.get(member.id);

        if (!windows || !fitsInWindow(windows, start, occupiedEnd)) {
          continue;
        }
        if (overlapsOccupied(member.occupied, start, occupiedEnd)) {
          continue;
        }

        freeStaff.push(member.id);
      }

      if (freeStaff.length > 0) {
        slots.push({ date, start, end, occupiedEnd, staffIds: freeStaff });
      }
    }
  }

  return slots;
}
