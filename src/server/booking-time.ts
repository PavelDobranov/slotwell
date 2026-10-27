// Configurable-zone scheduling primitives (M1 #62).
//
// Every function resolves wall-clock rules in an explicit IANA business zone
// passed by the caller — never the machine/device zone. M1 seeds exactly one
// zone (Europe/Sofia on `businessSettings.timeZone`); this module assumes none.
// Appointment instants are epoch milliseconds (PostgreSQL `timestamptz`), kept
// separate from the recurring local clock-time rules that produce them.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MINUTES_PER_DAY = 24 * 60;

/** The booking grid is anchored at business-local midnight. */
export const BOOKING_GRID_MINUTES = 15;

/**
 * Resolving a local wall-clock start can fail two ways around a DST change:
 * the local time never happens (spring gap) or happens twice (fall overlap).
 * Both are surfaced rather than silently resolved — a booking start that is not
 * `ok` is excluded; an invalid schedule-window boundary fails closed, using the
 * kind as a non-sensitive diagnostic.
 */
export type LocalStart =
  | { kind: "ok"; instant: number }
  | { kind: "nonexistent" }
  | { kind: "ambiguous" };

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partsFormatterCache.set(timeZone, formatter);
  }

  return formatter;
}

type LocalParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

function localParts(instant: number, timeZone: string): LocalParts {
  return Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(instant)
      .map(({ type, value }) => [type, value]),
  ) as unknown as LocalParts;
}

// The zone's UTC offset (east-positive, in ms) at a given instant.
function zoneOffsetMs(instant: number, timeZone: string): number {
  const { year, month, day, hour, minute, second } = localParts(
    instant,
    timeZone,
  );
  const wallAsUtc = Date.parse(
    `${year}-${month}-${day}T${hour}:${minute}:${second}Z`,
  );

  return wallAsUtc - instant;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatOffset(offsetMs: number): string {
  const sign = offsetMs < 0 ? "-" : "+";
  const abs = Math.abs(offsetMs);

  return `${sign}${pad2(Math.floor(abs / HOUR_MS))}:${pad2(
    Math.floor((abs % HOUR_MS) / MINUTE_MS),
  )}`;
}

// A UTC date is only a calendar-arithmetic carrier, never a business-local instant.
function calendarCarrier(date: string): Date {
  const carrier = new Date(`${date}T00:00:00Z`);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(carrier.getTime()) ||
    carrier.toISOString().slice(0, 10) !== date
  ) {
    throw new RangeError("Expected an ISO calendar date (YYYY-MM-DD)");
  }

  return carrier;
}

/**
 * Reject anything that is not a named IANA zone — in particular numeric
 * fixed-offset "zones", which carry no daylight-saving rules. Unknown
 * identifiers throw as well.
 */
export function assertIanaTimeZone(timeZone: string): void {
  if (typeof timeZone !== "string" || timeZone.length === 0) {
    throw new RangeError("Expected an IANA time-zone identifier");
  }

  if (
    /^[+-]\d{2}:?\d{2}$/.test(timeZone) ||
    /^(?:UTC|GMT)[+-]/.test(timeZone)
  ) {
    throw new RangeError(
      `Expected a named IANA zone, not a fixed offset: ${timeZone}`,
    );
  }

  try {
    // Constructing with an unrecognized identifier throws a RangeError.
    new Intl.DateTimeFormat("en-GB", { timeZone });
  } catch {
    throw new RangeError(`Unknown IANA time-zone identifier: ${timeZone}`);
  }
}

/** The business-local calendar date (YYYY-MM-DD) of an instant. */
export function businessDate(instant: number, timeZone: string): string {
  assertIanaTimeZone(timeZone);
  const { year, month, day } = localParts(instant, timeZone);

  return `${year}-${month}-${day}`;
}

/** Local-calendar day arithmetic, independent of any zone (used for the horizon). */
export function addCalendarDays(date: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new RangeError("Expected whole calendar days");
  }

  const carrier = calendarCarrier(date);
  carrier.setUTCDate(carrier.getUTCDate() + days);

  return carrier.toISOString().slice(0, 10);
}

/** Local weekday of a calendar date. Sunday = 0, Monday = 1, … Saturday = 6. */
export function businessWeekday(date: string): number {
  return calendarCarrier(date).getUTCDay();
}

/** True when a minute-of-day sits on the local 15-minute booking grid. */
export function isGridAligned(minuteOfDay: number): boolean {
  return (
    Number.isInteger(minuteOfDay) &&
    minuteOfDay >= 0 &&
    minuteOfDay < MINUTES_PER_DAY &&
    minuteOfDay % BOOKING_GRID_MINUTES === 0
  );
}

/**
 * Resolve a business-local wall-clock minute-of-day on a calendar date to an
 * exact instant, reporting DST gaps and overlaps instead of guessing an offset.
 */
export function resolveLocalStart(
  date: string,
  minuteOfDay: number,
  timeZone: string,
): LocalStart {
  assertIanaTimeZone(timeZone);
  calendarCarrier(date);

  if (
    !Number.isInteger(minuteOfDay) ||
    minuteOfDay < 0 ||
    minuteOfDay >= MINUTES_PER_DAY
  ) {
    throw new RangeError("Expected a minute-of-day within [0, 1440)");
  }

  const hour = pad2(Math.floor(minuteOfDay / 60));
  const minute = pad2(minuteOfDay % 60);
  const wallAsUtc = Date.parse(`${date}T${hour}:${minute}:00Z`);

  // Sample offsets on both sides of the day to capture both transition offsets.
  const candidateOffsets = new Set(
    [-24, -2, 0, 2, 24].map((offsetHours) =>
      zoneOffsetMs(wallAsUtc + offsetHours * HOUR_MS, timeZone),
    ),
  );

  const matches = new Set(
    [...candidateOffsets]
      .map((offset) => wallAsUtc - offset)
      .filter((instant) => {
        const parts = localParts(instant, timeZone);

        return (
          `${parts.year}-${parts.month}-${parts.day}` === date &&
          parts.hour === hour &&
          parts.minute === minute
        );
      }),
  );

  if (matches.size === 0) {
    return { kind: "nonexistent" };
  }

  if (matches.size === 1) {
    return { kind: "ok", instant: [...matches][0] };
  }

  return { kind: "ambiguous" };
}

/**
 * Advance an instant by elapsed minutes. Service and cleanup durations are
 * elapsed time, so an interval that spans a DST transition keeps its real
 * duration while its wall-clock end shifts by the offset change.
 */
export function addElapsedMinutes(instant: number, minutes: number): number {
  if (!Number.isFinite(instant)) {
    throw new RangeError("Expected a finite instant");
  }

  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new RangeError("Expected whole, non-negative elapsed minutes");
  }

  return instant + minutes * MINUTE_MS;
}

/** Serialize an instant as a UTC ISO 8601 timestamp (e.g. 2026-06-01T07:00:00.000Z). */
export function toUtcIso(instant: number): string {
  if (!Number.isFinite(instant)) {
    throw new RangeError("Expected a finite instant");
  }

  return new Date(instant).toISOString();
}

/**
 * Serialize an instant as an ISO 8601 timestamp with the business zone's
 * explicit offset at that instant (e.g. 2026-06-01T10:00:00+03:00).
 */
export function toOffsetIso(instant: number, timeZone: string): string {
  assertIanaTimeZone(timeZone);

  if (!Number.isFinite(instant)) {
    throw new RangeError("Expected a finite instant");
  }

  const { year, month, day, hour, minute, second } = localParts(
    instant,
    timeZone,
  );

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${formatOffset(
    zoneOffsetMs(instant, timeZone),
  )}`;
}
