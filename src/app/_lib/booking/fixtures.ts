import {
  addCalendarDays,
  businessDateAt,
  businessWeekday,
  localStart,
} from "@/app/_lib/booking/time";
import type {
  Clock,
  DemoSalon,
  Service,
  WeeklyHours,
} from "@/app/_lib/booking/types";

// Illustrative fictional content, not a real salon's identity or price list.
const services: readonly Service[] = [
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
    id: "color",
    name: "Боядисване на корени",
    category: "Коса",
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
    id: "mani",
    name: "Маникюр с гел лак",
    category: "Ръце",
    priceCents: 2500,
    durationMinutes: 60,
    cleanupMinutes: 10,
  },
];
const hours: WeeklyHours = {
  0: [],
  1: [{ startMinute: 540, endMinute: 1080 }],
  2: [{ startMinute: 540, endMinute: 1080 }],
  3: [{ startMinute: 540, endMinute: 1080 }],
  4: [{ startMinute: 540, endMinute: 1080 }],
  5: [{ startMinute: 540, endMinute: 1080 }],
  6: [{ startMinute: 600, endMinute: 960 }],
};

/** Explicit clock injection keeps walkthrough dates live without import/build-time dates. */
export function createDemoSalon(clock: Clock): DemoSalon {
  const today = businessDateAt(clock());
  const monday = addCalendarDays(today, (8 - businessWeekday(today)) % 7 || 7);
  // Monday working hours avoid DST transitions. Still fail closed at the timezone boundary.
  const start = localStart(monday, 600);
  const end = localStart(monday, 660);

  if (start === null || end === null) {
    throw new RangeError("Unresolvable demo hours");
  }

  return {
    name: "Ателие Мента",
    address: "ул. „Шипка“ 18, София",
    today,
    services,
    hours,
    staff: [
      {
        id: "mila",
        name: "Мила",
        description: "Дамско и мъжко подстригване",
        serviceIds: ["cut_w", "cut_m"],
        hours,
      },
      {
        id: "ivan",
        name: "Иван",
        description: "Мъжко подстригване и оформяне",
        serviceIds: ["cut_m", "blowdry"],
        hours: { ...hours, 3: [], 6: [] },
      },
      {
        id: "elena",
        name: "Елена",
        description: "Подстригване, боядисване и маникюр",
        serviceIds: ["cut_w", "color", "keratin", "mani"],
        hours: { ...hours, 1: [{ startMinute: 600, endMinute: 1020 }] },
      },
    ],
    occupied: [
      { staffId: "mila", start, end },
      { staffId: "ivan", start: start + 90 * 60_000, end: end + 90 * 60_000 },
    ],
    exceptions: [{ date: addCalendarDays(monday, 1), hours: [] }],
  };
}

/** Selected services are a set: order and accidental duplicate IDs do not change totals. */
export function serviceTotals(selected: readonly Service[]) {
  const distinct = new Map(selected.map((service) => [service.id, service]));

  return [...distinct.values()].reduce(
    (total, service) => ({
      // Services priced on site contribute no amount but mark the total as a lower bound.
      priceCents: total.priceCents + (service.priceCents ?? 0),
      hasVariablePrice: total.hasVariablePrice || service.priceCents === null,
      durationMinutes: total.durationMinutes + service.durationMinutes,
      cleanupMinutes: total.cleanupMinutes + service.cleanupMinutes,
    }),
    {
      priceCents: 0,
      hasVariablePrice: false,
      durationMinutes: 0,
      cleanupMinutes: 0,
    },
  );
}
