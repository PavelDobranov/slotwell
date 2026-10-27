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
  timestamp,
  unique,
  uuid,
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

// Matching by phone associates a possible returning client; it never grants
// access or supplies contact values for a later booking.
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey(),
    normalizedPhone: text("normalized_phone").notNull().unique(),
  },
  () => [
    check(
      "clients_phone_e164",
      sql`"normalized_phone" ~ '^[+][1-9][0-9]{1,14}$'`,
    ),
  ],
);

// Agreement snapshots have no guest update path. Completeness, catalog-derived
// sums and occupancy equality are enforced by the booking transaction (#69),
// not by these per-row constraints. Arbitrary SQL is not made append-only.
export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    status: text("status").notNull().default("confirmed"),
    contactName: text("contact_name").notNull(),
    contactPhone: text("contact_phone").notNull(),
    contactEmail: text("contact_email").notNull(),
    notes: text("notes"),
    staffName: text("staff_name").notNull(),
    businessAddress: text("business_address").notNull(),
    bookingTimeZone: text("booking_time_zone").notNull(),
    startsAt: timestamp("starts_at", {
      withTimezone: true,
      precision: 3,
      mode: "string",
    }).notNull(),
    serviceEndsAt: timestamp("service_ends_at", {
      withTimezone: true,
      precision: 3,
      mode: "string",
    }).notNull(),
    occupiedEndsAt: timestamp("occupied_ends_at", {
      withTimezone: true,
      precision: 3,
      mode: "string",
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3,
      mode: "string",
    }).notNull(),
    confirmationExpiresAt: timestamp("confirmation_expires_at", {
      withTimezone: true,
      precision: 3,
      mode: "string",
    }).notNull(),
  },
  () => [
    check("appointments_status_confirmed", sql`"status" = 'confirmed'`),
    check(
      "appointments_contact_name_valid",
      sql`"contact_name" = btrim("contact_name") AND length("contact_name") BETWEEN 1 AND 100`,
    ),
    check(
      "appointments_contact_phone_valid",
      sql`"contact_phone" = btrim("contact_phone") AND length("contact_phone") BETWEEN 1 AND 32`,
    ),
    check(
      "appointments_contact_email_valid",
      sql`"contact_email" = btrim("contact_email") AND length("contact_email") BETWEEN 1 AND 254`,
    ),
    check("appointments_notes_length", sql`length("notes") <= 1000`),
    check(
      "appointments_staff_name_nonblank",
      sql`length(btrim("staff_name")) > 0`,
    ),
    check(
      "appointments_business_address_nonblank",
      sql`length(btrim("business_address")) > 0`,
    ),
    check(
      "appointments_zone_nonblank",
      sql`length(btrim("booking_time_zone")) > 0`,
    ),
    check(
      "appointments_instants_valid",
      sql`"starts_at" > '-infinity'::timestamptz AND "starts_at" < "service_ends_at" AND "service_ends_at" <= "occupied_ends_at" AND "occupied_ends_at" < 'infinity'::timestamptz AND "created_at" > '-infinity'::timestamptz AND "created_at" < 'infinity'::timestamptz AND "confirmation_expires_at" < 'infinity'::timestamptz`,
    ),
    // Elapsed hours, not seven session-local calendar days across DST.
    check(
      "appointments_expiry_exact",
      sql`"confirmation_expires_at" = "service_ends_at" + INTERVAL '168 hours'`,
    ),
  ],
);

export const appointmentServices = pgTable(
  "appointment_services",
  {
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    position: integer("position").notNull(),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    name: text("name").notNull(),
    priceCents: integer("price_cents"),
    currency: char("currency", { length: 3 }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    cleanupMinutes: integer("cleanup_minutes").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.appointmentId, table.position] }),
    unique("appointment_services_distinct").on(
      table.appointmentId,
      table.serviceId,
    ),
    check("appointment_services_position_nonnegative", sql`"position" >= 0`),
    check("appointment_services_name_nonblank", sql`length(btrim("name")) > 0`),
    check(
      "appointment_services_price_nonnegative",
      sql`"price_cents" IS NULL OR "price_cents" >= 0`,
    ),
    check(
      "appointment_services_currency_uppercase",
      sql`"currency" ~ '^[A-Z]{3}$'`,
    ),
    check(
      "appointment_services_duration_positive",
      sql`"duration_minutes" > 0`,
    ),
    check(
      "appointment_services_cleanup_nonnegative",
      sql`"cleanup_minutes" >= 0`,
    ),
  ],
);

// Single occupancy table for booked appointment intervals and seeded non-client
// blocks, as half-open `[)` instant ranges. The database overlap invariant is a
// btree_gist EXCLUDE constraint added in the migration (drizzle cannot express
// it): no two rows for the same staff member may have overlapping periods, while
// boundary-touching adjacency is allowed. Appointment writes associate one row;
// seeded non-client blocks never carry an appointment association.
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
    appointmentId: uuid("appointment_id")
      .unique("staff_occupancy_appointment_id_unique")
      .references(() => appointments.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
  },
  () => [
    check(
      "staff_occupancy_appointment_kind",
      sql`("kind" = 'appointment') = ("appointment_id" IS NOT NULL)`,
    ),
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

export const appointmentAccess = pgTable(
  "appointment_access",
  {
    appointmentId: uuid("appointment_id")
      .primaryKey()
      .references(() => appointments.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    tokenHash: text("token_hash").notNull().unique(),
  },
  () => [
    check(
      "appointment_access_hash_valid",
      sql`"token_hash" ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

// Row locking serializes a pre-established intent. Success atomically stores
// the keyed payload fingerprint and encrypted usable-token replay, never a raw
// token or contact payload. #70 must retain material/keys through appointment
// expiry before clearing metadata to a permanent duplicate-prevention tombstone.
export const bookingOperations = pgTable(
  "booking_operations",
  {
    id: uuid("id").primaryKey(),
    credentialHash: text("credential_hash").notNull().unique(),
    state: text("state").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3,
      mode: "string",
    }).notNull(),
    submitBefore: timestamp("submit_before", {
      withTimezone: true,
      precision: 3,
      mode: "string",
    }).notNull(),
    appointmentId: uuid("appointment_id")
      .unique()
      .references(() => appointments.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    payloadFingerprint: text("payload_fingerprint"),
    fingerprintVersion: integer("fingerprint_version"),
    fingerprintKeyId: text("fingerprint_key_id"),
    encryptedReplay: text("encrypted_replay"),
    replayKeyId: text("replay_key_id"),
    replayExpiresAt: timestamp("replay_expires_at", {
      withTimezone: true,
      precision: 3,
      mode: "string",
    }),
  },
  () => [
    check(
      "booking_operations_credential_hash_valid",
      sql`"credential_hash" ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "booking_operations_state_valid",
      sql`"state" = 'pending' OR "state" = 'committed' OR "state" = 'abandoned' OR "state" = 'tombstone'`,
    ),
    check(
      "booking_operations_metadata_matches_state",
      sql`CASE WHEN "state" = 'committed' THEN "appointment_id" IS NOT NULL AND "payload_fingerprint" IS NOT NULL AND "fingerprint_version" IS NOT NULL AND "fingerprint_key_id" IS NOT NULL AND "encrypted_replay" IS NOT NULL AND "replay_key_id" IS NOT NULL AND "replay_expires_at" IS NOT NULL ELSE "appointment_id" IS NULL AND "payload_fingerprint" IS NULL AND "fingerprint_version" IS NULL AND "fingerprint_key_id" IS NULL AND "encrypted_replay" IS NULL AND "replay_key_id" IS NULL AND "replay_expires_at" IS NULL END`,
    ),
    check(
      "booking_operations_fingerprint_valid",
      sql`"payload_fingerprint" ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "booking_operations_version_positive",
      sql`"fingerprint_version" > 0`,
    ),
    check(
      "booking_operations_fingerprint_key_nonblank",
      sql`length(btrim("fingerprint_key_id")) > 0`,
    ),
    check(
      "booking_operations_replay_valid",
      sql`"encrypted_replay" ~ '^([a-f0-9]{2}){60,}$'`,
    ),
    check(
      "booking_operations_replay_key_nonblank",
      sql`length(btrim("replay_key_id")) > 0`,
    ),
    check(
      "booking_operations_instants_valid",
      sql`"created_at" > '-infinity'::timestamptz AND "created_at" < "submit_before" AND "submit_before" < 'infinity'::timestamptz AND "replay_expires_at" > "created_at" AND "replay_expires_at" < 'infinity'::timestamptz`,
    ),
  ],
);
