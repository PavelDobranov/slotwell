import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";

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
} from "@/server/availability/compute";
import { type CatalogDatabase, CatalogError } from "@/server/catalog";
import { addCalendarDays } from "@/shared/booking-time";
import { validateServiceSelection } from "@/shared/service-selection";

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
  validateServiceSelection(serviceIds);
  const [business] = await db
    .select()
    .from(businessSettings)
    .where(eq(businessSettings.id, 1));
  if (!business) throw new CatalogError("availability_unavailable");
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
    throw new CatalogError("unknown_services", { serviceIds: unknown });
  const [member] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.id, staffId), eq(staff.isActive, true)));
  if (!member) throw new CatalogError("unknown_staff");
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
