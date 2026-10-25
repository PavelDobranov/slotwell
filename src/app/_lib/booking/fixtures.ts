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
    id: "haircut",
    name: "Подстригване",
    priceCents: 2300,
    durationMinutes: 30,
    cleanupMinutes: 10,
  },
  {
    id: "beard",
    name: "Оформяне на брада",
    priceCents: 1200,
    durationMinutes: 20,
    cleanupMinutes: 5,
  },
  {
    id: "wash",
    name: "Измиване и оформяне",
    priceCents: 1800,
    durationMinutes: 30,
    cleanupMinutes: 5,
  },
  {
    id: "color",
    name: "Боядисване",
    priceCents: 5500,
    durationMinutes: 90,
    cleanupMinutes: 15,
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
    name: "Ателие Мента — демо салон",
    address: "ул. „Шипка“ 18, София (измислен адрес)",
    today,
    services,
    hours,
    staff: [
      {
        id: "mila",
        name: "Мила — демо специалист",
        description: "Подстригване, измиване и оформяне",
        serviceIds: ["haircut", "wash"],
        hours,
      },
      {
        id: "ivan",
        name: "Иван — демо специалист",
        description: "Подстригване и оформяне на брада",
        serviceIds: ["haircut", "beard"],
        hours: { ...hours, 3: [], 6: [] },
      },
      {
        id: "elena",
        name: "Елена — демо специалист",
        description: "Боядисване, измиване и оформяне",
        serviceIds: ["color", "wash"],
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
      priceCents: total.priceCents + service.priceCents,
      durationMinutes: total.durationMinutes + service.durationMinutes,
      cleanupMinutes: total.cleanupMinutes + service.cleanupMinutes,
    }),
    { priceCents: 0, durationMinutes: 0, cleanupMinutes: 0 },
  );
}
