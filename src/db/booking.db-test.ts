import assert from "node:assert/strict";
import fs from "node:fs";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { type SQL, sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { appointments } from "@/db/schema";
import { seedCatalog, seedSchedules } from "@/db/seed";
import { withTestDatabase } from "@/db/testing";

const clientId = "00000000-0000-4000-8000-000000000001";
const appointmentId = "00000000-0000-4000-8000-000000000002";
const operationId = "00000000-0000-4000-8000-000000000003";

// Hide only the final committed file during initial setup, then restore it and
// use the real migrator to upgrade a populated predecessor schema. No SQL is
// replaced, no shared/app objects are reset, and the harness retains ownership.
test("booking migration upgrades seeded scheduling data without changing catalog or blocks", async () => {
  const migrationsFolder = fileURLToPath(
    new URL("../../drizzle", import.meta.url),
  );
  const latest = readMigrationFiles({ migrationsFolder }).at(-1);
  assert.ok(latest);
  const exists = fs.existsSync;
  const hidden = mock.method(fs, "existsSync", (path: fs.PathLike) =>
    String(path) === `${migrationsFolder}/${latest.name}/migration.sql`
      ? false
      : exists(path),
  );
  try {
    await withTestDatabase({}, async ({ db, migrate }) => {
      hidden.mock.restore();
      await seedCatalog(db);
      await seedSchedules(db, { anchor: Date.parse("2030-03-01T12:00:00Z") });
      const before = await rows(
        db,
        sql`SELECT id, staff_id, period, kind FROM staff_occupancy ORDER BY id`,
      );
      const catalog = await rows(db, sql`SELECT * FROM services ORDER BY id`);
      assert.ok(before.length > 0);
      assert.equal(
        (
          await rows(
            db,
            sql`SELECT count(*)::int AS count FROM __drizzle_migrations`,
          )
        )[0].count,
        3,
      );
      await migrate();
      assert.deepEqual(
        await rows(
          db,
          sql`SELECT id, staff_id, period, kind FROM staff_occupancy ORDER BY id`,
        ),
        before,
      );
      assert.deepEqual(
        await rows(db, sql`SELECT * FROM services ORDER BY id`),
        catalog,
      );
      assert.ok(
        (await rows(db, sql`SELECT appointment_id FROM staff_occupancy`)).every(
          (row) => row.appointment_id === null,
        ),
      );
      await seedCatalog(db);
      await seedSchedules(db, { anchor: Date.parse("2030-03-01T12:00:00Z") });
      assert.deepEqual(
        await rows(
          db,
          sql`SELECT id, staff_id, period, kind FROM staff_occupancy ORDER BY id`,
        ),
        before,
      );
      assert.equal(
        (
          await rows(db, sql`SELECT count(*)::int AS count FROM appointments`)
        )[0].count,
        0,
      );
    });
  } finally {
    hidden.mock.restore();
  }
});

async function rows(db: NodePgDatabase, query: SQL) {
  return db.execute(query, "objects");
}

function violation(code: string, constraint?: string) {
  return (error: unknown): boolean => {
    let current = error;
    while (current instanceof Error) {
      if ("code" in current && current.code === code) {
        if (constraint) {
          assert.ok("constraint" in current);
          assert.equal(current.constraint, constraint);
        }
        return true;
      }
      current = current.cause;
    }
    return false;
  };
}

async function insertBooking(db: NodePgDatabase) {
  await db.execute(sql`INSERT INTO staff (id, name, description, sort_order)
    VALUES ('booking-staff', 'Original staff', 'Fictional', 0)`);
  await db.execute(sql`INSERT INTO services
    (id, name, category, price_cents, currency, duration_minutes, cleanup_minutes, sort_order)
    VALUES ('booking-service', 'Original service', 'Fictional', NULL, 'EUR', 60, 15, 0)`);
  await db.execute(
    sql`INSERT INTO clients (id, normalized_phone) VALUES (${clientId}, '+359888123456')`,
  );
  await db.execute(sql`INSERT INTO appointments
    (id, client_id, staff_id, contact_name, contact_phone, contact_email, notes,
     staff_name, business_address, booking_time_zone, starts_at, service_ends_at,
     occupied_ends_at, created_at, confirmation_expires_at)
    VALUES (${appointmentId}, ${clientId}, 'booking-staff', 'Guest', '0888 123 456', 'guest@example.test', 'Private note',
      'Original staff', 'Original address', 'America/New_York', '2030-03-10T01:30:00.123-05:00',
      '2030-03-10T03:30:00.123-04:00', '2030-03-10T03:45:00.123-04:00', '2030-03-01T00:00:00Z', '2030-03-17T07:30:00.123Z')`);
  await db.execute(sql`INSERT INTO appointment_services
    (appointment_id, position, service_id, name, price_cents, currency, duration_minutes, cleanup_minutes)
    VALUES (${appointmentId}, 0, 'booking-service', 'Original service', NULL, 'EUR', 60, 15)`);
  await db.execute(sql`INSERT INTO staff_occupancy (staff_id, period, kind, appointment_id)
    VALUES ('booking-staff', tstzrange('2030-03-10T06:30:00.123Z', '2030-03-10T07:45:00.123Z', '[)'), 'appointment', ${appointmentId})`);
}

test("booking checks reject malformed contacts, times and service values without weakening valid boundaries", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await insertBooking(db);
    const cases: [string, string, unknown, string][] = [
      ["clients", "normalized_phone", "0888123456", "clients_phone_e164"],
      ["clients", "normalized_phone", "+0123", "clients_phone_e164"],
      [
        "clients",
        "normalized_phone",
        "+1234567890123456",
        "clients_phone_e164",
      ],
      ["appointments", "status", "cancelled", "appointments_status_confirmed"],
      ...[
        ["contact_name", 100],
        ["contact_phone", 32],
        ["contact_email", 254],
      ].flatMap(([column, limit]): [string, string, unknown, string][] => [
        ["appointments", String(column), "", `appointments_${column}_valid`],
        [
          "appointments",
          String(column),
          " padded ",
          `appointments_${column}_valid`,
        ],
        [
          "appointments",
          String(column),
          "x".repeat(Number(limit) + 1),
          `appointments_${column}_valid`,
        ],
      ]),
      ["appointments", "notes", "x".repeat(1001), "appointments_notes_length"],
      ["appointments", "staff_name", " ", "appointments_staff_name_nonblank"],
      [
        "appointments",
        "business_address",
        " ",
        "appointments_business_address_nonblank",
      ],
      ["appointments", "booking_time_zone", " ", "appointments_zone_nonblank"],
      ["appointments", "starts_at", "-infinity", "appointments_instants_valid"],
      [
        "appointments",
        "starts_at",
        "2030-03-10T07:30:00.123Z",
        "appointments_instants_valid",
      ],
      [
        "appointments",
        "occupied_ends_at",
        "infinity",
        "appointments_instants_valid",
      ],
      [
        "appointments",
        "occupied_ends_at",
        "2030-03-10T07:29:00Z",
        "appointments_instants_valid",
      ],
      ["appointments", "created_at", "infinity", "appointments_instants_valid"],
      [
        "appointments",
        "confirmation_expires_at",
        "2030-03-17T07:30:00.124Z",
        "appointments_expiry_exact",
      ],
      [
        "appointment_services",
        "position",
        -1,
        "appointment_services_position_nonnegative",
      ],
      [
        "appointment_services",
        "name",
        " ",
        "appointment_services_name_nonblank",
      ],
      [
        "appointment_services",
        "price_cents",
        -1,
        "appointment_services_price_nonnegative",
      ],
      [
        "appointment_services",
        "currency",
        "eur",
        "appointment_services_currency_uppercase",
      ],
      [
        "appointment_services",
        "duration_minutes",
        0,
        "appointment_services_duration_positive",
      ],
      [
        "appointment_services",
        "cleanup_minutes",
        -1,
        "appointment_services_cleanup_nonnegative",
      ],
    ];
    for (const [table, column, value, constraint] of cases) {
      await assert.rejects(
        db.execute(
          sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier(column)} = ${value}`,
        ),
        violation("23514", constraint),
      );
    }
    for (const [column, limit] of [
      ["contact_name", 100],
      ["contact_phone", 32],
      ["contact_email", 254],
    ] as const) {
      await db.execute(
        sql`UPDATE appointments SET ${sql.identifier(column)} = ${"я".repeat(limit)}`,
      );
    }
    await db.execute(
      sql`UPDATE appointments SET notes = ${"я".repeat(1000)}, occupied_ends_at = service_ends_at`,
    );
    await db.execute(
      sql`UPDATE appointment_services SET price_cents = 0, cleanup_minutes = 0`,
    );
    await db.execute(
      sql`UPDATE clients SET normalized_phone = '+123456789012345'`,
    );
    for (const column of [
      "client_id",
      "staff_id",
      "contact_name",
      "contact_phone",
      "contact_email",
      "staff_name",
      "business_address",
      "booking_time_zone",
      "starts_at",
      "service_ends_at",
      "occupied_ends_at",
      "created_at",
      "confirmation_expires_at",
      "status",
    ]) {
      await assert.rejects(
        db.execute(
          sql`UPDATE appointments SET ${sql.identifier(column)} = NULL`,
        ),
        violation("23502"),
      );
    }
  });
});

test("operation and access metadata enforce unique credentials, complete replay and minimal tombstones", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await insertBooking(db);
    await db.execute(sql`INSERT INTO booking_operations (id, credential_hash, state, created_at, submit_before)
      VALUES (${operationId}, ${"a".repeat(64)}, 'pending', '2030-03-01T00:00Z', '2030-03-02T00:00Z')`);
    await assert.rejects(
      db.execute(sql`UPDATE booking_operations SET state = 'unknown'`),
      violation("23514", "booking_operations_state_valid"),
    );
    for (const column of [
      "appointment_id",
      "payload_fingerprint",
      "fingerprint_version",
      "fingerprint_key_id",
      "encrypted_replay",
      "replay_key_id",
      "replay_expires_at",
    ]) {
      const value = (
        {
          appointment_id: appointmentId,
          payload_fingerprint: "b".repeat(64),
          fingerprint_version: 1,
          fingerprint_key_id: "fingerprint-v1",
          encrypted_replay: "c".repeat(120),
          replay_key_id: "replay-v1",
          replay_expires_at: "2030-03-17T07:30:00.123Z",
        } as Record<string, unknown>
      )[column];
      await assert.rejects(
        db.execute(
          sql`UPDATE booking_operations SET ${sql.identifier(column)} = ${value}`,
        ),
        violation("23514", "booking_operations_metadata_matches_state"),
      );
    }
    await assert.rejects(
      db.execute(sql`UPDATE booking_operations SET state = 'committed'`),
      violation("23514", "booking_operations_metadata_matches_state"),
    );
    await db.execute(sql`UPDATE booking_operations SET state = 'committed', appointment_id = ${appointmentId},
      payload_fingerprint = ${"b".repeat(64)}, fingerprint_version = 1, fingerprint_key_id = 'fingerprint-v1',
      encrypted_replay = ${"c".repeat(120)}, replay_key_id = 'replay-v1', replay_expires_at = '2030-03-17T07:30:00.123Z'`);
    for (const column of [
      "appointment_id",
      "payload_fingerprint",
      "fingerprint_version",
      "fingerprint_key_id",
      "encrypted_replay",
      "replay_key_id",
      "replay_expires_at",
    ]) {
      await assert.rejects(
        db.execute(
          sql`UPDATE booking_operations SET ${sql.identifier(column)} = NULL`,
        ),
        violation("23514", "booking_operations_metadata_matches_state"),
      );
    }
    await assert.rejects(
      db.execute(
        sql`UPDATE booking_operations SET appointment_id = '00000000-0000-4000-8000-000000000099'`,
      ),
      violation("23503"),
    );
    await assert.rejects(
      db.execute(
        sql`INSERT INTO booking_operations SELECT '00000000-0000-4000-8000-000000000009', ${"e".repeat(64)}, state, created_at, submit_before, appointment_id, payload_fingerprint, fingerprint_version, fingerprint_key_id, encrypted_replay, replay_key_id, replay_expires_at FROM booking_operations`,
      ),
      violation("23505"),
    );
    const cases: [string, unknown, string][] = [
      [
        "credential_hash",
        "invalid",
        "booking_operations_credential_hash_valid",
      ],
      [
        "payload_fingerprint",
        "B".repeat(64),
        "booking_operations_fingerprint_valid",
      ],
      ["fingerprint_version", 0, "booking_operations_version_positive"],
      [
        "fingerprint_key_id",
        " ",
        "booking_operations_fingerprint_key_nonblank",
      ],
      ["encrypted_replay", "c".repeat(119), "booking_operations_replay_valid"],
      ["replay_key_id", " ", "booking_operations_replay_key_nonblank"],
      [
        "submit_before",
        "2030-03-01T00:00Z",
        "booking_operations_instants_valid",
      ],
      ["created_at", "-infinity", "booking_operations_instants_valid"],
      ["replay_expires_at", "infinity", "booking_operations_instants_valid"],
    ];
    for (const [column, value, constraint] of cases) {
      await assert.rejects(
        db.execute(
          sql`UPDATE booking_operations SET ${sql.identifier(column)} = ${value}`,
        ),
        violation("23514", constraint),
      );
    }
    await db.execute(
      sql`INSERT INTO appointment_access (appointment_id, token_hash) VALUES (${appointmentId}, ${"d".repeat(64)})`,
    );
    await assert.rejects(
      db.execute(
        sql`UPDATE appointment_access SET token_hash = 'plaintext-token'`,
      ),
      violation("23514", "appointment_access_hash_valid"),
    );
    await assert.rejects(
      db.execute(sql`INSERT INTO booking_operations (id, credential_hash, state, created_at, submit_before)
      VALUES ('00000000-0000-4000-8000-000000000004', ${"a".repeat(64)}, 'pending', '2030-03-01T00:00Z', '2030-03-02T00:00Z')`),
      violation("23505"),
    );
    await assert.rejects(
      db.execute(sql`UPDATE booking_operations SET state = 'tombstone'`),
      violation("23514", "booking_operations_metadata_matches_state"),
    );
    await db.execute(sql`UPDATE booking_operations SET state = 'tombstone', appointment_id = NULL, payload_fingerprint = NULL,
      fingerprint_version = NULL, fingerprint_key_id = NULL, encrypted_replay = NULL, replay_key_id = NULL, replay_expires_at = NULL`);
    const [tombstone] = await rows(db, sql`SELECT * FROM booking_operations`);
    assert.equal(tombstone.credential_hash, "a".repeat(64));
    assert.equal(tombstone.appointment_id, null);
    assert.equal(tombstone.encrypted_replay, null);
    await db.execute(sql`DELETE FROM appointment_access`);
    assert.equal(
      (await rows(db, sql`SELECT count(*)::int AS count FROM appointments`))[0]
        .count,
      1,
    );
  });
});

test("booking FKs, unique associations and occupancy exclusion protect parents and permit adjacency", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await insertBooking(db);
    const [original] = await db.select().from(appointments);
    const secondId = "00000000-0000-4000-8000-000000000005";
    await db.insert(appointments).values({
      ...original,
      id: secondId,
      contactName: "Another guest",
      contactEmail: "other@example.test",
      startsAt: "2030-03-10T07:45:00.123Z",
      serviceEndsAt: "2030-03-10T08:45:00.123Z",
      occupiedEndsAt: "2030-03-10T09:00:00.123Z",
      confirmationExpiresAt: "2030-03-17T08:45:00.123Z",
    });
    assert.deepEqual(
      (await db.select().from(appointments)).find(
        (value) => value.id === appointmentId,
      ),
      original,
    );
    assert.equal(
      (await rows(db, sql`SELECT count(*)::int AS count FROM clients`))[0]
        .count,
      1,
    );
    await assert.rejects(
      db.execute(
        sql`INSERT INTO clients VALUES ('00000000-0000-4000-8000-000000000006', '+359888123456')`,
      ),
      violation("23505"),
    );
    for (const [table, column] of [
      ["appointments", "client_id"],
      ["appointments", "staff_id"],
      ["appointment_services", "appointment_id"],
      ["appointment_services", "service_id"],
      ["staff_occupancy", "appointment_id"],
    ] as const) {
      const missing =
        column === "staff_id" || column === "service_id"
          ? "missing"
          : "00000000-0000-4000-8000-000000000099";
      await assert.rejects(
        db.execute(
          sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier(column)} = ${missing}`,
        ),
        violation("23503"),
      );
    }
    await assert.rejects(
      db.execute(
        sql`INSERT INTO appointment_access VALUES ('00000000-0000-4000-8000-000000000099', ${"d".repeat(64)})`,
      ),
      violation("23503"),
    );
    await db.execute(
      sql`INSERT INTO appointment_access VALUES (${appointmentId}, ${"d".repeat(64)})`,
    );
    await assert.rejects(
      db.execute(
        sql`INSERT INTO appointment_access VALUES (${secondId}, ${"d".repeat(64)})`,
      ),
      violation("23505"),
    );
    await assert.rejects(
      db.execute(
        sql`INSERT INTO appointment_services SELECT appointment_id, 1, service_id, name, price_cents, currency, duration_minutes, cleanup_minutes FROM appointment_services`,
      ),
      violation("23505", "appointment_services_distinct"),
    );
    await assert.rejects(
      db.execute(
        sql`INSERT INTO appointment_services SELECT * FROM appointment_services`,
      ),
      violation("23505"),
    );
    await assert.rejects(
      db.execute(sql`INSERT INTO staff_occupancy (staff_id, period, kind, appointment_id)
      VALUES ('booking-staff', tstzrange('2030-03-10T07:00Z', '2030-03-10T08:00Z', '[)'), 'appointment', ${secondId})`),
      violation("23P01", "staff_occupancy_no_overlap"),
    );
    await db.execute(sql`INSERT INTO staff_occupancy (staff_id, period, kind, appointment_id)
      VALUES ('booking-staff', tstzrange('2030-03-10T07:45:00.123Z', '2030-03-10T09:00:00.123Z', '[)'), 'appointment', ${secondId})`);
    await assert.rejects(
      db.execute(sql`INSERT INTO staff_occupancy (staff_id, period, kind, appointment_id)
      VALUES ('booking-staff', tstzrange('2030-03-10T09:00:00.123Z', '2030-03-10T10:00Z', '[)'), 'appointment', ${secondId})`),
      violation("23505", "staff_occupancy_appointment_id_unique"),
    );
    await assert.rejects(
      db.execute(
        sql`UPDATE staff_occupancy SET appointment_id = NULL WHERE appointment_id = ${appointmentId}`,
      ),
      violation("23514", "staff_occupancy_appointment_kind"),
    );
    await assert.rejects(
      db.execute(
        sql`UPDATE staff_occupancy SET kind = 'block' WHERE appointment_id = ${appointmentId}`,
      ),
      violation("23514", "staff_occupancy_appointment_kind"),
    );
    for (const table of ["appointments", "clients", "services", "staff"]) {
      await assert.rejects(
        db.execute(sql`DELETE FROM ${sql.identifier(table)}`),
        violation("23001"),
      );
    }
  });
});

test("expiry uses exactly 168 elapsed hours across both DST changes in a non-UTC session", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await db.execute(sql`SET TIME ZONE 'America/New_York'`);
    await insertBooking(db);
    for (const end of [
      "2030-03-09T15:00:00.123Z",
      "2030-11-02T15:00:00.123Z",
    ]) {
      await db.execute(sql`UPDATE appointments SET starts_at = ${end}::timestamptz - INTERVAL '1 hour',
        service_ends_at = ${end}, occupied_ends_at = ${end}, confirmation_expires_at = ${end}::timestamptz + INTERVAL '168 hours'`);
      const [value] = await db.select().from(appointments);
      assert.equal(
        new Date(value.confirmationExpiresAt).getTime() -
          new Date(value.serviceEndsAt).getTime(),
        168 * 60 * 60 * 1000,
      );
      await assert.rejects(
        db.execute(
          sql`UPDATE appointments SET confirmation_expires_at = service_ends_at + INTERVAL '7 days'`,
        ),
        violation("23514", "appointments_expiry_exact"),
      );
    }
  });
});

test("a failed complete write rolls back client, agreement, service, occupancy, access and replay together", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await db.execute(sql`BEGIN`);
    try {
      await insertBooking(db);
      await db.execute(
        sql`INSERT INTO appointment_access VALUES (${appointmentId}, ${"d".repeat(64)})`,
      );
      await db.execute(sql`INSERT INTO booking_operations VALUES (${operationId}, ${"a".repeat(64)}, 'committed',
        '2030-03-01T00:00Z', '2030-03-02T00:00Z', ${appointmentId}, ${"b".repeat(64)}, 1, 'fingerprint-v1', ${"c".repeat(120)}, 'replay-v1', '2030-03-17T07:30:00.123Z')`);
      await assert.rejects(
        db.execute(sql`UPDATE appointment_services SET service_id = 'missing'`),
        violation("23503"),
      );
    } finally {
      await db.execute(sql`ROLLBACK`);
    }
    for (const table of [
      "clients",
      "appointments",
      "appointment_services",
      "staff_occupancy",
      "appointment_access",
      "booking_operations",
    ]) {
      assert.equal(
        (
          await rows(
            db,
            sql`SELECT count(*)::int AS count FROM ${sql.identifier(table)}`,
          )
        )[0].count,
        0,
      );
    }
    await insertBooking(db);
    await seedCatalog(db);
    await seedSchedules(db, { anchor: Date.parse("2030-03-01T12:00Z") });
    const agreement = await rows(db, sql`SELECT * FROM appointments`);
    const occupancy = await rows(
      db,
      sql`SELECT * FROM staff_occupancy ORDER BY id`,
    );
    await seedCatalog(db);
    await seedSchedules(db, { anchor: Date.parse("2030-03-01T12:00Z") });
    assert.deepEqual(
      await rows(db, sql`SELECT * FROM appointments`),
      agreement,
    );
    assert.deepEqual(
      await rows(db, sql`SELECT * FROM staff_occupancy ORDER BY id`),
      occupancy,
    );
  });
});

test("multiple booked services retain explicit order and independent values after catalog/address edits", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await insertBooking(db);
    await seedCatalog(db);
    await db.execute(sql`INSERT INTO services
      (id, name, category, price_cents, currency, duration_minutes, cleanup_minutes, sort_order)
      VALUES ('second-service', 'Second service', 'Fictional', 1250, 'EUR', 30, 5, 1)`);
    await db.execute(sql`INSERT INTO appointment_services VALUES
      (${appointmentId}, 1, 'second-service', 'Second service', 1250, 'EUR', 30, 5)`);
    await db.execute(sql`UPDATE appointments SET service_ends_at = '2030-03-10T08:00:00.123Z',
      occupied_ends_at = '2030-03-10T08:20:00.123Z', confirmation_expires_at = '2030-03-17T08:00:00.123Z'`);
    await db.execute(
      sql`UPDATE staff_occupancy SET period = tstzrange('2030-03-10T06:30:00.123Z', '2030-03-10T08:20:00.123Z', '[)') WHERE appointment_id = ${appointmentId}`,
    );
    const before = await rows(
      db,
      sql`SELECT * FROM appointment_services ORDER BY position`,
    );
    const agreement = await rows(db, sql`SELECT * FROM appointments`);
    assert.deepEqual(
      before.map((value) => [
        value.position,
        value.name,
        value.price_cents,
        value.duration_minutes,
        value.cleanup_minutes,
      ]),
      [
        [0, "Original service", null, 60, 15],
        [1, "Second service", 1250, 30, 5],
      ],
    );
    await db.execute(
      sql`UPDATE services SET name = 'Changed', price_cents = 1, currency = 'BGN', duration_minutes = 1, cleanup_minutes = 0`,
    );
    await db.execute(
      sql`UPDATE business_settings SET address = 'Changed address', time_zone = 'Asia/Tokyo'`,
    );
    assert.deepEqual(
      await rows(db, sql`SELECT * FROM appointment_services ORDER BY position`),
      before,
    );
    assert.deepEqual(
      await rows(db, sql`SELECT * FROM appointments`),
      agreement,
    );
  });
});

test("booking schema preserves millisecond instants, zone and booked values across catalog edits", async () => {
  await withTestDatabase({}, async ({ db, migrate }) => {
    await insertBooking(db);
    const agreement = await rows(db, sql`SELECT * FROM appointments`);
    const bookedServices = await rows(
      db,
      sql`SELECT * FROM appointment_services`,
    );
    await db.execute(sql`UPDATE staff SET name = 'Changed staff'`);
    await db.execute(
      sql`UPDATE services SET name = 'Changed service', price_cents = 999, duration_minutes = 90, cleanup_minutes = 30`,
    );
    await migrate();
    assert.deepEqual(
      await rows(db, sql`SELECT * FROM appointments`),
      agreement,
    );
    assert.deepEqual(
      await rows(db, sql`SELECT * FROM appointment_services`),
      bookedServices,
    );
    const value = agreement[0];
    assert.equal(value.status, "confirmed");
    assert.equal(value.booking_time_zone, "America/New_York");
    assert.equal(
      new Date(String(value.starts_at)).toISOString(),
      "2030-03-10T06:30:00.123Z",
    );
    assert.equal(
      new Date(String(value.service_ends_at)).toISOString(),
      "2030-03-10T07:30:00.123Z",
    );
    assert.equal(
      new Date(String(value.occupied_ends_at)).toISOString(),
      "2030-03-10T07:45:00.123Z",
    );
    assert.equal(bookedServices[0].price_cents, null);
    assert.equal(value.contact_phone, "0888 123 456");
    // Exercise the actual Drizzle mapping too, not only the raw pg driver.
    const [mapped] = await db.select().from(appointments);
    assert.equal(typeof mapped.startsAt, "string");
    assert.equal(
      JSON.parse(JSON.stringify(mapped)).bookingTimeZone,
      "America/New_York",
    );
    assert.equal(
      new Date(mapped.startsAt).toISOString(),
      "2030-03-10T06:30:00.123Z",
    );
  });
});
