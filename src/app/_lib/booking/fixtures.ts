import {
  addCalendarDays,
  businessDateAt,
  businessWeekday,
  localStart,
} from "@/app/_lib/booking/time";
import type {
  Clock,
  DemoSalon,
  OccupiedInterval,
  Service,
  WeeklyHours,
} from "@/app/_lib/booking/types";

// User-provided staff identities; studio details, services and prices are illustrative.
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
];
const hairServiceIds = services
  .filter(({ category }) => category === "Коса")
  .map(({ id }) => id);

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
  const daysUntilNextMonday = (8 - businessWeekday(today)) % 7 || 7;
  const monday = addCalendarDays(today, daysUntilNextMonday);
  const closureDate = addCalendarDays(monday, 1);
  // Monday working hours avoid DST transitions. Still fail closed at the timezone boundary.
  const start = localStart(monday, 600);
  const end = localStart(monday, 660);

  if (start === null || end === null) {
    throw new RangeError("Unresolvable demo hours");
  }

  const occupied: OccupiedInterval[] = [
    { staffId: "mimi", start, end },
    { staffId: "pavel", start: start + 90 * 60_000, end: end + 90 * 60_000 },
  ];
  // A rolling fortnight of visits, including cleanup; never expose client identities.
  const visits = [
    { staffId: "mimi", from: 600, to: 655 },
    { staffId: "pavel", from: 690, to: 730 },
    { staffId: "emil", from: 780, to: 870 },
  ];
  for (let offset = 0; offset < 14; offset += 1) {
    const date = addCalendarDays(today, offset);
    const weekday = businessWeekday(date);
    if (weekday === 0 || date === closureDate) continue;
    for (const visit of visits) {
      if (visit.staffId === "pavel" && (weekday === 3 || weekday === 6))
        continue;
      if (date === monday && visit.staffId !== "emil") continue;
      const visitStart = localStart(date, visit.from);
      const visitEnd = localStart(date, visit.to);
      if (visitStart === null || visitEnd === null) {
        throw new RangeError("Unresolvable demo visit");
      }
      occupied.push({
        staffId: visit.staffId,
        start: visitStart,
        end: visitEnd,
      });
    }
  }

  return {
    name: "Студио за красота Нюанс",
    address: "ул. „Шипка“ 18, София",
    today,
    services,
    hours,
    staff: [
      {
        id: "mimi",
        name: "Мими Ибрамова",
        imageUrl: "/staff/mimi-ibramova.jpg",
        description:
          "Подстригване, оформяне на коса и брада, грижа и терапии за коса",
        serviceIds: hairServiceIds,
        hours,
      },
      {
        id: "pavel",
        name: "Павел Добранов",
        imageUrl: "/staff/pavel-dobranov.jpg",
        description:
          "Подстригване, оформяне на коса и брада, грижа и терапии за коса",
        serviceIds: hairServiceIds,
        hours: { ...hours, 3: [], 6: [] },
      },
      {
        id: "emil",
        name: "Емил Стойков",
        imageUrl: "/staff/emil-stoykov.jpg",
        description:
          "Релаксиращи и дълбокотъканни масажи за възстановяване и отмора",
        serviceIds: [
          "massage_relax",
          "massage_deep",
          "massage_back",
          "massage_sport",
          "massage_aroma",
        ],
        hours: { ...hours, 1: [{ startMinute: 600, endMinute: 1020 }] },
      },
    ],
    occupied,
    exceptions: [{ date: closureDate, hours: [] }],
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
