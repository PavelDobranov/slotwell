import { isDeepStrictEqual } from "node:util";
import { eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  businessHours,
  businessSettings,
  services,
  staff,
  staffServices,
} from "@/db/schema";

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
