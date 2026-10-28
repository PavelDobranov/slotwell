import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

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
// Pure, db-independent scheduling-time utilities (no cycle): the seed resolves
// rolling dates/instants in the configured business zone, never the machine zone.
import {
  addCalendarDays,
  assertIanaTimeZone,
  businessDate,
  resolveLocalStart,
  toUtcIso,
} from "@/shared/booking-time";

// Frozen fictional catalog, owned by the server. No dated frontend fixture import.
const catalogServices: (typeof services.$inferInsert)[] = [
  {
    id: "cut_w",
    name: "Дамско подстригване",
    category: "Коса",
    priceCents: 2800,
    durationMinutes: 45,
    cleanupMinutes: 10,
  },
  {
    id: "cut_m",
    name: "Мъжко подстригване",
    category: "Коса",
    priceCents: 1800,
    durationMinutes: 30,
    cleanupMinutes: 10,
  },
  {
    id: "massage_relax",
    name: "Релаксиращ масаж",
    category: "Масажи",
    priceCents: 4200,
    durationMinutes: 75,
    cleanupMinutes: 15,
  },
  {
    id: "blowdry",
    name: "Изсушаване и оформяне",
    category: "Коса",
    priceCents: 1500,
    durationMinutes: 30,
    cleanupMinutes: 5,
  },
  {
    id: "keratin",
    name: "Кератинова терапия",
    category: "Коса",
    priceCents: null,
    durationMinutes: 90,
    cleanupMinutes: 15,
  },
  {
    id: "massage_deep",
    name: "Дълбокотъканен масаж",
    category: "Масажи",
    priceCents: 4500,
    durationMinutes: 60,
    cleanupMinutes: 10,
  },
  {
    id: "cut_child",
    name: "Детско подстригване до 12 г.",
    category: "Коса",
    priceCents: 1400,
    durationMinutes: 30,
    cleanupMinutes: 10,
  },
  {
    id: "beard",
    name: "Оформяне на брада",
    category: "Коса",
    priceCents: 1200,
    durationMinutes: 20,
    cleanupMinutes: 10,
  },
  {
    id: "scalp",
    name: "Терапия за скалп и коса",
    category: "Коса",
    priceCents: 3200,
    durationMinutes: 45,
    cleanupMinutes: 10,
  },
  {
    id: "massage_back",
    name: "Масаж на гръб, врат и рамене",
    category: "Масажи",
    priceCents: 2800,
    durationMinutes: 30,
    cleanupMinutes: 10,
  },
  {
    id: "massage_sport",
    name: "Спортен масаж",
    category: "Масажи",
    priceCents: 4800,
    durationMinutes: 60,
    cleanupMinutes: 15,
  },
  {
    id: "massage_aroma",
    name: "Ароматерапевтичен масаж",
    category: "Масажи",
    priceCents: 5200,
    durationMinutes: 90,
    cleanupMinutes: 15,
  },
].map((service, sortOrder) => ({
  ...service,
  currency: "EUR",
  isActive: true,
  sortOrder,
}));

const settings = {
  id: 1,
  name: "Студио за красота Нюанс",
  address: "ул. „Шипка“ 18, София",
  timeZone: "Europe/Sofia",
  currency: "EUR",
  defaultPhoneCountry: "BG",
  leadTimeMinutes: 60,
  horizonDays: 60,
};
const hours = Array.from({ length: 6 }, (_, index) => ({
  businessId: 1,
  weekday: index + 1,
  windowIndex: 0,
  opensAt: index === 5 ? "10:00:00" : "09:00:00",
  closesAt: index === 5 ? "16:00:00" : "18:00:00",
}));
const catalogStaff = [
  {
    id: "mimi",
    name: "Мими Ибрамова",
    imageUrl: "/staff/mimi-ibramova.jpg",
    description:
      "Подстригване, оформяне на коса и брада, грижа и терапии за коса",
  },
  {
    id: "pavel",
    name: "Павел Добранов",
    imageUrl: "/staff/pavel-dobranov.jpg",
    description:
      "Подстригване, оформяне на коса и брада, грижа и терапии за коса",
  },
  {
    id: "emil",
    name: "Емил Стойков",
    imageUrl: "/staff/emil-stoykov.jpg",
    description:
      "Релаксиращи и дълбокотъканни масажи за възстановяване и отмора",
  },
].map((person, sortOrder) => ({ ...person, isActive: true, sortOrder }));
const competencies = catalogStaff.flatMap(({ id }) =>
  catalogServices
    .filter(({ category }) => category === (id === "emil" ? "Масажи" : "Коса"))
    .map(({ id: serviceId }) => ({ staffId: id, serviceId })),
);
const serviceIds = catalogServices.map(({ id }) => id);
const staffIds = catalogStaff.map(({ id }) => id);

/** Intl may accept numeric offsets on newer runtimes; those are not named zones. */
export function validateNamedTimeZone(zone: string): void {
  try {
    if (!/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(zone)) throw new Error();
    new Intl.DateTimeFormat("en", { timeZone: zone }).format(0);
  } catch {
    throw new Error("Invalid catalog time zone");
  }
}

// Structural handle accepts both script databases and the harness's held clients.
type CatalogDatabase = Pick<NodePgDatabase, "transaction">;

/** Initialize only an absent reserved graph; canonical reruns are read-only. */
export async function seedCatalog(db: CatalogDatabase): Promise<void> {
  validateNamedTimeZone(settings.timeZone);
  await db.transaction(async (tx) => {
    // Stable application namespace/key, transaction-scoped on the SAME session.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(583104, 58)`);
    const readGraph = async () => [
      await tx
        .select()
        .from(businessSettings)
        .where(eq(businessSettings.id, 1)),
      await tx
        .select()
        .from(businessHours)
        .where(eq(businessHours.businessId, 1)),
      await tx.select().from(services).where(inArray(services.id, serviceIds)),
      await tx.select().from(staff).where(inArray(staff.id, staffIds)),
      // ENTIRE sets for reserved staff, including links to nonfixture services.
      await tx
        .select()
        .from(staffServices)
        .where(inArray(staffServices.staffId, staffIds)),
    ];
    const before = await readGraph();
    if (before.every((rows) => rows.length === 0)) {
      await tx.insert(businessSettings).values(settings);
      await tx.insert(businessHours).values(hours);
      await tx.insert(services).values(catalogServices);
      await tx.insert(staff).values(catalogStaff);
      await tx.insert(staffServices).values(competencies);
    }
    const expected = [
      [settings],
      hours,
      catalogServices,
      catalogStaff,
      competencies,
    ];
    const actual = await readGraph();
    // Compare unordered row sets but ALL canonical columns (including sort_order).
    const sorted = (rows: unknown[]) =>
      [...rows].sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      );
    if (
      !actual.every((rows, index) =>
        isDeepStrictEqual(sorted(rows), sorted(expected[index])),
      )
    ) {
      throw new Error("Catalog fixture drift");
    }
  });
}

// ---- Scheduling / occupancy seed (#63) ----

// Business weekly hours by local weekday (Sunday = 0), mirroring the catalog
// business_hours so every staff window stays within the business's open hours.
const businessDayHours: Record<number, readonly [string, string]> = {
  1: ["09:00:00", "18:00:00"],
  2: ["09:00:00", "18:00:00"],
  3: ["09:00:00", "18:00:00"],
  4: ["09:00:00", "18:00:00"],
  5: ["09:00:00", "18:00:00"],
  6: ["10:00:00", "16:00:00"],
};

// Modest per-staff variation: each works a subset of the open days.
const staffWorkingDays: Record<string, readonly number[]> = {
  mimi: [1, 2, 4, 5, 6], // off Wednesday
  pavel: [1, 2, 3, 4, 5], // off Saturday
  emil: [2, 3, 4, 5, 6], // off Monday
};

const staffScheduleRows: (typeof staffSchedules.$inferInsert)[] =
  Object.entries(staffWorkingDays).flatMap(([staffId, days]) =>
    days.map((weekday) => ({
      staffId,
      weekday,
      windowIndex: 0,
      opensAt: businessDayHours[weekday][0],
      closesAt: businessDayHours[weekday][1],
    })),
  );

type SeedException = {
  businessId: number | null;
  staffId: string | null;
  dayOffset: number;
  windowIndex: number;
  isClosed: boolean;
  opensAt: string | null;
  closesAt: string | null;
};

// Rolling dated exceptions, positioned relative to the injected anchor so the
// demo keeps a live future holiday/override as calendar time advances.
const rollingExceptions: readonly SeedException[] = [
  // A business-wide holiday closure.
  {
    businessId: 1,
    staffId: null,
    dayOffset: 10,
    windowIndex: 0,
    isClosed: true,
    opensAt: null,
    closesAt: null,
  },
  // A staff member works a shorter day.
  {
    businessId: null,
    staffId: "mimi",
    dayOffset: 3,
    windowIndex: 0,
    isClosed: false,
    opensAt: "12:00:00",
    closesAt: "16:00:00",
  },
  // A staff member takes a day off.
  {
    businessId: null,
    staffId: "emil",
    dayOffset: 5,
    windowIndex: 0,
    isClosed: true,
    opensAt: null,
    closesAt: null,
  },
];

type SeedBlock = {
  staffId: string;
  dayOffset: number;
  startMinute: number;
  endMinute: number;
};

// Rolling non-client blocks (e.g. a standing lunch, a personal errand).
const rollingBlocks: readonly SeedBlock[] = [
  { staffId: "emil", dayOffset: 1, startMinute: 13 * 60, endMinute: 14 * 60 },
  {
    staffId: "pavel",
    dayOffset: 2,
    startMinute: 15 * 60,
    endMinute: 16 * 60 + 30,
  },
];

/**
 * Seed static per-staff weekly schedules and rolling dated exceptions/blocks,
 * positioned by an injected business-local `anchor` (epoch ms). Non-destructive
 * and idempotent: existing rows — including any booked appointments — are
 * preserved, reinserting a schedule is a no-op, an existing exception is left
 * untouched, and a block that would overlap existing occupancy is skipped. The
 * catalog must already be seeded (the business time zone is read from it).
 */
export async function seedSchedules(
  db: CatalogDatabase,
  { anchor }: { anchor: number },
): Promise<void> {
  if (!Number.isSafeInteger(anchor)) throw new Error("Invalid seed anchor");
  await db.transaction(async (tx) => {
    // Stable application namespace/key, transaction-scoped on the SAME session.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(583104, 63)`);
    const [settingsRow] = await tx
      .select({ timeZone: businessSettings.timeZone })
      .from(businessSettings)
      .where(eq(businessSettings.id, 1));
    if (!settingsRow) {
      throw new Error("Catalog must be seeded before schedules");
    }
    const { timeZone } = settingsRow;
    assertIanaTimeZone(timeZone);
    const today = businessDate(anchor, timeZone);

    // Static weekly schedules: the composite key makes reinsertion a no-op.
    await tx
      .insert(staffSchedules)
      .values(staffScheduleRows)
      .onConflictDoNothing();

    // Rolling exceptions: insert only when the same subject/date/window is absent.
    for (const exception of rollingExceptions) {
      const onDate = addCalendarDays(today, exception.dayOffset);
      const existing = await tx
        .select({ id: scheduleExceptions.id })
        .from(scheduleExceptions)
        .where(
          and(
            exception.businessId === null
              ? isNull(scheduleExceptions.businessId)
              : eq(scheduleExceptions.businessId, exception.businessId),
            exception.staffId === null
              ? isNull(scheduleExceptions.staffId)
              : eq(scheduleExceptions.staffId, exception.staffId),
            eq(scheduleExceptions.onDate, onDate),
            eq(scheduleExceptions.windowIndex, exception.windowIndex),
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await tx.insert(scheduleExceptions).values({
          businessId: exception.businessId,
          staffId: exception.staffId,
          onDate,
          windowIndex: exception.windowIndex,
          isClosed: exception.isClosed,
          opensAt: exception.opensAt,
          closesAt: exception.closesAt,
        });
      }
    }

    // Rolling blocks: skip DST-invalid local times, and skip any that would
    // overlap existing occupancy so reseeds and real appointments are preserved.
    for (const block of rollingBlocks) {
      const onDate = addCalendarDays(today, block.dayOffset);
      const start = resolveLocalStart(onDate, block.startMinute, timeZone);
      const end = resolveLocalStart(onDate, block.endMinute, timeZone);
      if (start.kind !== "ok" || end.kind !== "ok") continue;
      const period = sql`tstzrange(${toUtcIso(start.instant)}::timestamptz, ${toUtcIso(
        end.instant,
      )}::timestamptz, '[)')`;
      const overlapping = await tx
        .select({ one: sql`1` })
        .from(staffOccupancy)
        .where(
          sql`${staffOccupancy.staffId} = ${block.staffId} AND ${staffOccupancy.period} && ${period}`,
        )
        .limit(1);
      if (overlapping.length === 0) {
        await tx.execute(
          sql`INSERT INTO staff_occupancy (staff_id, period, kind) VALUES (${block.staffId}, ${period}, 'block')`,
        );
      }
    }
  });
}
