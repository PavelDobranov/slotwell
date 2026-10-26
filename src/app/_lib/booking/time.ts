export const BUSINESS_TIME_ZONE = "Europe/Sofia";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dateFormatter = new Intl.DateTimeFormat("bg-BG", {
  timeZone: BUSINESS_TIME_ZONE,
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});
const weekdayDateFormatter = new Intl.DateTimeFormat("bg-BG", {
  timeZone: BUSINESS_TIME_ZONE,
  weekday: "long",
  month: "long",
  day: "numeric",
});
const monthFormatter = new Intl.DateTimeFormat("bg-BG", {
  timeZone: BUSINESS_TIME_ZONE,
  month: "long",
  year: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat("bg-BG", {
  timeZone: BUSINESS_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const euroFormatter = new Intl.NumberFormat("bg-BG", {
  style: "currency",
  currency: "EUR",
});

function localParts(instant: number) {
  return Object.fromEntries(
    partsFormatter
      .formatToParts(instant)
      .map(({ type, value }) => [type, value]),
  );
}

// A UTC date is only a calendar arithmetic carrier, never a salon-local instant.
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

export function businessDateAt(instant: number): string {
  const { year, month, day } = localParts(instant);

  return `${year}-${month}-${day}`;
}

export function addCalendarDays(date: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new RangeError("Expected whole calendar days");
  }

  const carrier = calendarCarrier(date);
  carrier.setUTCDate(carrier.getUTCDate() + days);

  return carrier.toISOString().slice(0, 10);
}

/** Sunday = 0, Monday = 1, … Saturday = 6. */
export function businessWeekday(date: string): number {
  return calendarCarrier(date).getUTCDay();
}

/** Minutes since local midnight → epoch milliseconds; reject gaps AND overlaps.
 * This is a minute-precision demo boundary, not a production timezone scheduler.
 */
export function localStart(date: string, minute: number): number | null {
  const midnight = calendarCarrier(date).getTime();

  if (!Number.isInteger(minute) || minute < 0 || minute >= 1440) {
    throw new RangeError("Expected minutes within a calendar day");
  }

  const wallTime = midnight + minute * MINUTE_MS;
  // Sample either side of the day to capture both Sofia transition offsets.
  const offsets = new Set(
    [-1, 0, 1].map((day) => {
      const probe = midnight + day * DAY_MS;
      const {
        year,
        month,
        day: localDay,
        hour,
        minute: localMinute,
      } = localParts(probe);

      return (
        Date.parse(`${year}-${month}-${localDay}T${hour}:${localMinute}:00Z`) -
        probe
      );
    }),
  );
  const matches = [...offsets]
    .map((offset) => wallTime - offset)
    .filter((instant) => {
      const parts = localParts(instant);

      return (
        businessDateAt(instant) === date &&
        Number(parts.hour) * 60 + Number(parts.minute) === minute
      );
    });

  return matches.length === 1 ? matches[0] : null;
}

export function formatBusinessDate(date: string): string {
  return dateFormatter.format(calendarCarrier(date));
}

/** Weekday and day without the year, capitalized: "Понеделник, 26 октомври". */
export function formatBusinessWeekdayDate(date: string): string {
  const text = weekdayDateFormatter.format(calendarCarrier(date));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Month and year spanning a visible range: "Октомври 2026" or "Октомври – ноември 2026". */
export function formatBusinessMonthRange(from: string, to: string): string {
  const parse = (date: string) => {
    const [month, year] = monthFormatter
      .format(calendarCarrier(date))
      .replace(/ г\.$/, "")
      .split(" ");
    return { month, year };
  };
  const start = parse(from);
  const end = parse(to);
  const label =
    start.month === end.month
      ? `${start.month} ${start.year}`
      : `${start.month} – ${end.month} ${end.year}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatBusinessTime(instant: number): string {
  return timeFormatter.format(instant);
}

export function formatEuro(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("Expected integer euro cents");
  }

  return euroFormatter.format(cents / 100);
}
