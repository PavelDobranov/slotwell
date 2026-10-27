import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
} from "drizzle-orm/pg-core";

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
