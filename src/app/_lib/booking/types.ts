/** Live or fixed clock returning epoch milliseconds; read at the operation boundary. */
export type Clock = () => number;

export type Service = {
  readonly id: string;
  readonly name: string;
  /** Category heading the service groups under in the picker, e.g. "Коса". */
  readonly category: string;
  /** Fixed price in cents, or null when it is settled on site (e.g. by hair length). */
  readonly priceCents: number | null;
  readonly durationMinutes: number;
  readonly cleanupMinutes: number;
};

/** Half-open wall-clock interval in minutes since Sofia midnight. */
export type WorkingHours = {
  readonly startMinute: number;
  readonly endMinute: number;
};
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type WeeklyHours = Readonly<Record<Weekday, readonly WorkingHours[]>>;

export type Staff = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly serviceIds: readonly string[];
  readonly hours: WeeklyHours;
};

/** Half-open occupied interval in epoch milliseconds, INCLUDING trailing cleanup. */
export type OccupiedInterval = {
  readonly staffId: string;
  readonly start: number;
  readonly end: number;
};

/** Replaces weekly hours on an ISO calendar date; no staffId means salon-wide. */
export type ScheduleException = {
  readonly date: string;
  readonly staffId?: string;
  readonly hours: readonly WorkingHours[];
};

export type DemoSalon = {
  readonly name: string;
  readonly address: string;
  readonly today: string;
  readonly services: readonly Service[];
  readonly staff: readonly Staff[];
  readonly hours: WeeklyHours;
  readonly occupied: readonly OccupiedInterval[];
  readonly exceptions: readonly ScheduleException[];
};
