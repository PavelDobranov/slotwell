import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { Hono } from "hono";

import {
  businessHours,
  businessSettings,
  scheduleExceptions,
  services,
  staff,
  staffOccupancy,
  staffSchedules,
  staffServices,
} from "@/db/schema";
import {
  computeAvailability,
  type ScheduleException,
} from "@/server/availability";
import { addCalendarDays } from "@/server/booking-time";
import {
  type CatalogDatabase,
  CatalogError,
  validateServiceSelection,
} from "@/server/catalog";

export const MAX_AVAILABILITY_DAYS = 7;
export type AvailabilityQuery = {
  staffId: string;
  serviceIds: string[];
  from: string;
  to: string;
};
export type AvailabilityView = {
  timeZone: string;
  serverNow: string;
  from: string;
  to: string;
  days: { date: string; slots: { start: string; end: string }[] }[];
};

/** Strict public boundary: no client clock, duration, cleanup, price or eligibility. */
export function validateAvailabilityQuery(
  params: URLSearchParams,
): AvailabilityQuery {
  for (const key of params.keys()) {
    if (!["staff", "service", "from", "to"].includes(key))
      throw new CatalogError("invalid_query", 400);
  }
  const staffIds = params.getAll("staff");
  if (staffIds.length !== 1 || !staffIds[0].trim() || staffIds[0].length > 64)
    throw new CatalogError("invalid_staff_id", 400);
  const serviceIds = validateServiceSelection(params.getAll("service"));
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  try {
    if (params.getAll("from").length !== 1 || params.getAll("to").length !== 1)
      throw new RangeError();
    addCalendarDays(from, 0);
    addCalendarDays(to, 0);
    // PostgreSQL civil dates have no year zero; keep the public range four-digit AD.
    if (from.startsWith("0000") || to.startsWith("0000") || from > to)
      throw new RangeError();
  } catch {
    throw new CatalogError("invalid_date_range", 400);
  }
  if (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000 >=
    MAX_AVAILABILITY_DAYS
  ) {
    throw new CatalogError("date_range_too_large", 400, {
      max: MAX_AVAILABILITY_DAYS,
    });
  }
  return { staffId: staffIds[0], serviceIds, from, to };
}

function minute(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}
function weekly(
  rows: { weekday: number; opensAt: string; closesAt: string }[],
) {
  return rows.map((row) => ({
    weekday: row.weekday,
    opensMinute: minute(row.opensAt),
    closesMinute: minute(row.closesAt),
  }));
}
function exceptions(
  rows: (typeof scheduleExceptions.$inferSelect)[],
): ScheduleException[] {
  return rows.map((row) => {
    if (row.isClosed) return { onDate: row.onDate, isClosed: true };
    if (!row.opensAt || !row.closesAt)
      throw new Error("Invalid schedule configuration");
    return {
      onDate: row.onDate,
      isClosed: false,
      opensMinute: minute(row.opensAt),
      closesMinute: minute(row.closesAt),
    };
  });
}

/** Advisory read, never a hold. Confirmation must revalidate inside its transaction. */
export async function readAvailability(
  db: CatalogDatabase,
  query: AvailabilityQuery,
  now = Date.now(),
): Promise<AvailabilityView> {
  const { staffId, serviceIds, from, to } = query;
  const [business] = await db
    .select()
    .from(businessSettings)
    .where(eq(businessSettings.id, 1));
  if (!business) throw new CatalogError("availability_unavailable", 500);
  const selected = await db
    .select({
      id: services.id,
      durationMinutes: services.durationMinutes,
      cleanupMinutes: services.cleanupMinutes,
    })
    .from(services)
    .where(and(inArray(services.id, serviceIds), eq(services.isActive, true)));
  const known = new Set(selected.map((row) => row.id));
  const unknown = serviceIds.filter((id) => !known.has(id));
  if (unknown.length)
    throw new CatalogError("unknown_services", 400, { serviceIds: unknown });
  const [member] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.id, staffId), eq(staff.isActive, true)));
  if (!member) throw new CatalogError("unknown_staff", 400);
  const qualifications = await db
    .select({ id: staffServices.serviceId })
    .from(staffServices)
    .where(
      and(
        eq(staffServices.staffId, staffId),
        inArray(staffServices.serviceId, serviceIds),
      ),
    );
  const hours = await db
    .select()
    .from(businessHours)
    .where(eq(businessHours.businessId, 1));
  const schedules = await db
    .select()
    .from(staffSchedules)
    .where(eq(staffSchedules.staffId, staffId));
  const overrides = await db
    .select()
    .from(scheduleExceptions)
    .where(
      and(
        or(
          eq(scheduleExceptions.businessId, 1),
          eq(scheduleExceptions.staffId, staffId),
        ),
        gte(scheduleExceptions.onDate, from),
        lte(scheduleExceptions.onDate, to),
      ),
    );
  // Conservative UTC envelope avoids resolving potentially ambiguous local midnights.
  // It includes every local window in the requested dates, even across offset changes.
  // Epoch seconds also work when the envelope crosses the four-digit AD range.
  const lower = Date.parse(`${from}T00:00:00Z`) / 1000 - 2 * 86_400;
  const upper = Date.parse(`${to}T00:00:00Z`) / 1000 + 3 * 86_400;
  const occupied = await db
    .select({
      startInstant:
        sql`extract(epoch from lower(${staffOccupancy.period})) * 1000`.mapWith(
          Number,
        ),
      endInstant:
        sql`extract(epoch from upper(${staffOccupancy.period})) * 1000`.mapWith(
          Number,
        ),
    })
    .from(staffOccupancy)
    .where(
      and(
        eq(staffOccupancy.staffId, staffId),
        sql`${staffOccupancy.period} && tstzrange(to_timestamp(${lower}), to_timestamp(${upper}), '[)')`,
      ),
    );
  const slots = computeAvailability({
    now,
    dateRange: { from, to },
    services: selected,
    business: {
      ...business,
      weekly: weekly(hours),
      exceptions: exceptions(overrides.filter((row) => row.businessId === 1)),
    },
    staff: [
      {
        id: staffId,
        qualifiedServiceIds: qualifications.map((row) => row.id),
        weekly: weekly(schedules),
        exceptions: exceptions(
          overrides.filter((row) => row.staffId === staffId),
        ),
        occupied,
      },
    ],
  });
  const days: AvailabilityView["days"] = [];
  for (let date = from; date <= to; date = addCalendarDays(date, 1)) {
    days.push({
      date,
      slots: slots
        .filter((slot) => slot.date === date)
        .map((slot) => ({
          start: new Date(slot.start).toISOString(),
          end: new Date(slot.end).toISOString(),
        })),
    });
    if (date === to) break; // Do not advance beyond the final supported calendar date.
  }
  return {
    timeZone: business.timeZone,
    serverNow: new Date(now).toISOString(),
    from,
    to,
    days,
  };
}

export function registerAvailabilityRoutes(
  app: Hono<{ Bindings: { db?: CatalogDatabase } }>,
) {
  app.get("/availability", async (c) => {
    c.header("Cache-Control", "no-store");
    const now = Date.now();
    try {
      const query = validateAvailabilityQuery(new URL(c.req.url).searchParams);
      if (!c.env?.db) throw new CatalogError("availability_unavailable", 500);
      return c.json(await readAvailability(c.env.db, query, now));
    } catch (error) {
      if (error instanceof CatalogError)
        return c.json(error.body(), error.status as 400 | 500);
      return c.json({ error: { code: "internal" } }, 500);
    }
  });
}
