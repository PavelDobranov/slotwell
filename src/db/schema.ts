import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
} from "drizzle-orm/pg-core";

// PostgreSQL range type drizzle has no first-class builder for. Occupancy spans
// are always stored as canonical half-open `[)` intervals, constructed with
// `tstzrange(lower, upper, '[)')`; the database CHECK below pins that shape.
const tstzrange = customType<{ data: string }>({
  dataType() {
    return "tstzrange";
  },
});

export const scaffoldChecks = pgTable("scaffold_checks", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  label: text("label").notNull(),
});

// Checks intentionally use unqualified columns: catalog DDL must stay within
// the migration connection's schema, including the private test search_path.
export const businessSettings = pgTable(
  "business_settings",
  {
    id: smallint("id").primaryKey(),
    name: text("name").notNull(),
    address: text("address").notNull(),
    timeZone: text("time_zone").notNull(),
    defaultPhoneCountry: char("default_phone_country", { length: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    leadTimeMinutes: integer("lead_time_minutes").notNull(),
    horizonDays: integer("horizon_days").notNull(),
  },
  () => [
    check("business_settings_singleton", sql`"id" = 1`),
    check("business_settings_name_nonblank", sql`length(btrim("name")) > 0`),
    check(
      "business_settings_address_nonblank",
      sql`length(btrim("address")) > 0`,
    ),
    // Named IANA validation belongs at seed/config boundaries, not in SQL.
    check(
      "business_settings_time_zone_nonblank",
      sql`length(btrim("time_zone")) > 0`,
    ),
    check(
      "business_settings_phone_country_uppercase",
      sql`"default_phone_country" ~ '^[A-Z]{2}$'`,
    ),
    check(
      "business_settings_currency_uppercase",
      sql`"currency" ~ '^[A-Z]{3}$'`,
    ),
    check(
      "business_settings_lead_time_nonnegative",
      sql`"lead_time_minutes" >= 0`,
    ),
    check("business_settings_horizon_nonnegative", sql`"horizon_days" >= 0`),
  ],
);

export const businessHours = pgTable(
  "business_hours",
  {
    businessId: smallint("business_id")
      .notNull()
      .references(() => businessSettings.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    weekday: smallint("weekday").notNull(),
    windowIndex: integer("window_index").notNull(),
    opensAt: time("opens_at", { precision: 0, withTimezone: false }).notNull(),
    closesAt: time("closes_at", {
      precision: 0,
      withTimezone: false,
    }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.businessId, table.weekday, table.windowIndex],
    }),
    check("business_hours_weekday_range", sql`"weekday" BETWEEN 0 AND 6`),
    check("business_hours_window_index_nonnegative", sql`"window_index" >= 0`),
    // Local-hour storage only; no overnight/24:00 or window-merging policy.
    check(
      "business_hours_opens_at_minute",
      sql`EXTRACT(SECOND FROM "opens_at") = 0`,
    ),
    check(
      "business_hours_closes_at_minute",
      sql`EXTRACT(SECOND FROM "closes_at") = 0`,
    ),
  ],
);

export const services = pgTable(
  "services",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    priceCents: integer("price_cents"),
    currency: char("currency", { length: 3 }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    cleanupMinutes: integer("cleanup_minutes").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull(),
  },
  () => [
    check("services_id_nonblank", sql`length(btrim("id")) > 0`),
    check("services_name_nonblank", sql`length(btrim("name")) > 0`),
    check("services_category_nonblank", sql`length(btrim("category")) > 0`),
    check(
      "services_price_nonnegative",
      sql`"price_cents" IS NULL OR "price_cents" >= 0`,
    ),
    check("services_currency_uppercase", sql`"currency" ~ '^[A-Z]{3}$'`),
    check("services_duration_positive", sql`"duration_minutes" > 0`),
    check("services_cleanup_nonnegative", sql`"cleanup_minutes" >= 0`),
    check("services_sort_order_nonnegative", sql`"sort_order" >= 0`),
  ],
);

export const staff = pgTable(
  "staff",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    imageUrl: text("image_url"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull(),
  },
  () => [
    check("staff_id_nonblank", sql`length(btrim("id")) > 0`),
    check("staff_name_nonblank", sql`length(btrim("name")) > 0`),
    check("staff_description_nonblank", sql`length(btrim("description")) > 0`),
    check("staff_sort_order_nonnegative", sql`"sort_order" >= 0`),
  ],
);

export const staffServices = pgTable(
  "staff_services",
  {
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
  },
  (table) => [primaryKey({ columns: [table.staffId, table.serviceId] })],
);

// Weekly local working hours per staff member. Mirrors business_hours: local
// clock only (Sunday = 0 … Saturday = 6), no overnight/24:00 or merge policy.
export const staffSchedules = pgTable(
  "staff_schedules",
  {
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    weekday: smallint("weekday").notNull(),
    windowIndex: integer("window_index").notNull(),
    opensAt: time("opens_at", { precision: 0, withTimezone: false }).notNull(),
    closesAt: time("closes_at", {
      precision: 0,
      withTimezone: false,
    }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.staffId, table.weekday, table.windowIndex],
    }),
    check("staff_schedules_weekday_range", sql`"weekday" BETWEEN 0 AND 6`),
    check("staff_schedules_window_index_nonnegative", sql`"window_index" >= 0`),
    check(
      "staff_schedules_opens_at_minute",
      sql`EXTRACT(SECOND FROM "opens_at") = 0`,
    ),
    check(
      "staff_schedules_closes_at_minute",
      sql`EXTRACT(SECOND FROM "closes_at") = 0`,
    ),
  ],
);

// Dated overrides/closures for the business OR a staff member. A subject's rows
// for a date replace that subject's weekly schedule for that date: a single
// is_closed row means fully closed; is_closed=false rows carry the replacement
// windows. The surrogate id is a stable handle; the seed keeps one coherent set
// per subject/date (a nullable two-subject UNIQUE could not enforce that, since
// PostgreSQL treats NULL subjects as distinct).
export const scheduleExceptions = pgTable(
  "schedule_exceptions",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    businessId: smallint("business_id").references(() => businessSettings.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    staffId: text("staff_id").references(() => staff.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    onDate: date("on_date").notNull(),
    windowIndex: integer("window_index").notNull(),
    isClosed: boolean("is_closed").notNull(),
    opensAt: time("opens_at", { precision: 0, withTimezone: false }),
    closesAt: time("closes_at", { precision: 0, withTimezone: false }),
  },
  () => [
    check(
      "schedule_exceptions_window_index_nonnegative",
      sql`"window_index" >= 0`,
    ),
    // Exactly one subject: a business-wide exception or a staff-specific one.
    check(
      "schedule_exceptions_one_subject",
      sql`("business_id" IS NOT NULL) <> ("staff_id" IS NOT NULL)`,
    ),
    // A closed row carries no hours; an open override carries both. Expressed
    // as "is_closed matches each hour's nullness" so no keyword precedes a
    // parenthesis (the migration preflight reads `OR (`/`AND (` as a call).
    check(
      "schedule_exceptions_hours_match_closed",
      sql`"is_closed" = ("opens_at" IS NULL) AND "is_closed" = ("closes_at" IS NULL)`,
    ),
    check(
      "schedule_exceptions_opens_at_minute",
      sql`"opens_at" IS NULL OR EXTRACT(SECOND FROM "opens_at") = 0`,
    ),
    check(
      "schedule_exceptions_closes_at_minute",
      sql`"closes_at" IS NULL OR EXTRACT(SECOND FROM "closes_at") = 0`,
    ),
  ],
);

// Single occupancy table for booked appointment intervals and seeded non-client
// blocks, as half-open `[)` instant ranges. The database overlap invariant is a
// btree_gist EXCLUDE constraint added in the migration (drizzle cannot express
// it): no two rows for the same staff member may have overlapping periods, while
// boundary-touching adjacency is allowed. The appointment foreign key arrives
// with the appointments table (#68); #63 seeds only kind='block' rows.
export const staffOccupancy = pgTable(
  "staff_occupancy",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    period: tstzrange("period").notNull(),
    kind: text("kind").notNull(),
  },
  () => [
    check(
      "staff_occupancy_kind_valid",
      sql`"kind" = 'appointment' OR "kind" = 'block'`,
    ),
    // Canonical, bounded, half-open [) span; adjacency depends on this shape.
    check(
      "staff_occupancy_period_canonical",
      sql`NOT isempty("period") AND lower_inc("period") AND NOT upper_inc("period") AND lower("period") IS NOT NULL AND upper("period") IS NOT NULL`,
    ),
  ],
);
