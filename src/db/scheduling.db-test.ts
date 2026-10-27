import assert from "node:assert/strict";
import { test } from "node:test";
import { type SQL, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { withTestDatabase } from "@/db/testing";

async function rows(db: NodePgDatabase, query: SQL) {
  return db.execute(query, "objects");
}

// Driver errors can be wrapped by Drizzle; assert SQLSTATE/constraint, never
// accept a missing table or an unrelated SQL failure as constraint evidence.
function violation(code: string, constraint?: string) {
  return (error: unknown): boolean => {
    let current: unknown = error;
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

// Minimal parents for the scheduling/occupancy foreign keys; the exact catalog
// values are irrelevant to these structural constraints.
async function seedSubjects(db: NodePgDatabase) {
  await db.execute(sql`INSERT INTO business_settings
    (id, name, address, time_zone, default_phone_country, currency, lead_time_minutes, horizon_days)
    VALUES (1, 'Fictional studio', 'Fictional address', 'Europe/Sofia', 'BG', 'EUR', 60, 60)`);
  await db.execute(sql`INSERT INTO staff (id, name, description, sort_order)
    VALUES ('mimi', 'Mimi', 'Fictional description', 0),
           ('emil', 'Emil', 'Fictional description', 1)`);
}

function block(staff: string, from: string, to: string, bounds = "[)") {
  return sql`INSERT INTO staff_occupancy (staff_id, period, kind)
    VALUES (${staff}, tstzrange(${from}::timestamptz, ${to}::timestamptz, ${bounds}), 'block')`;
}

test("staff_occupancy enforces the half-open overlap invariant per staff member", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await seedSubjects(db);
    await db.execute(
      block("mimi", "2026-11-02 10:00+02", "2026-11-02 11:00+02"),
    );
    // Boundary-touching adjacency is allowed (half-open ends before it opens).
    await db.execute(
      block("mimi", "2026-11-02 11:00+02", "2026-11-02 12:00+02"),
    );
    // A true overlap for the same staff member is rejected by the exclusion.
    await assert.rejects(
      db.execute(block("mimi", "2026-11-02 11:30+02", "2026-11-02 12:30+02")),
      violation("23P01", "staff_occupancy_no_overlap"),
    );
    // The same interval for a different staff member is independent.
    await db.execute(
      block("emil", "2026-11-02 11:30+02", "2026-11-02 12:30+02"),
    );
    assert.equal(
      (
        await rows(db, sql`SELECT count(*)::int AS count FROM staff_occupancy`)
      )[0].count,
      3,
    );
  });
});

test("staff_occupancy rejects non-canonical, empty, unbounded and invalid-kind rows", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await seedSubjects(db);
    // Closed upper bound violates the canonical half-open [) shape.
    await assert.rejects(
      db.execute(
        block("mimi", "2026-11-02 10:00+02", "2026-11-02 11:00+02", "[]"),
      ),
      violation("23514", "staff_occupancy_period_canonical"),
    );
    // Empty span.
    await assert.rejects(
      db.execute(block("mimi", "2026-11-02 10:00+02", "2026-11-02 10:00+02")),
      violation("23514", "staff_occupancy_period_canonical"),
    );
    // Unbounded upper end.
    await assert.rejects(
      db.execute(sql`INSERT INTO staff_occupancy (staff_id, period, kind)
        VALUES ('mimi', tstzrange('2026-11-02 10:00+02'::timestamptz, NULL, '[)'), 'block')`),
      violation("23514", "staff_occupancy_period_canonical"),
    );
    // Unknown kind.
    await assert.rejects(
      db.execute(sql`INSERT INTO staff_occupancy (staff_id, period, kind)
        VALUES ('mimi', tstzrange('2026-11-02 10:00+02'::timestamptz, '2026-11-02 11:00+02'::timestamptz, '[)'), 'holiday')`),
      violation("23514", "staff_occupancy_kind_valid"),
    );
    // Unknown staff member.
    await assert.rejects(
      db.execute(block("ghost", "2026-11-02 10:00+02", "2026-11-02 11:00+02")),
      violation("23503"),
    );
  });
});

test("schedule_exceptions enforces exactly one subject and closed/hours consistency", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await seedSubjects(db);
    const row = (
      businessId: string,
      staffId: string,
      isClosed: string,
      opensAt: string,
      closesAt: string,
    ) => sql`INSERT INTO schedule_exceptions
      (business_id, staff_id, on_date, window_index, is_closed, opens_at, closes_at)
      VALUES (${sql.raw(businessId)}, ${sql.raw(staffId)}, '2026-11-05', 0,
              ${sql.raw(isClosed)}, ${sql.raw(opensAt)}, ${sql.raw(closesAt)})`;
    // Valid business-wide closure and a valid staff override.
    await db.execute(row("1", "NULL", "true", "NULL", "NULL"));
    await db.execute(row("NULL", "'mimi'", "false", "'10:00'", "'14:00'"));
    // No subject, or both subjects.
    await assert.rejects(
      db.execute(row("NULL", "NULL", "true", "NULL", "NULL")),
      violation("23514", "schedule_exceptions_one_subject"),
    );
    await assert.rejects(
      db.execute(row("1", "'mimi'", "true", "NULL", "NULL")),
      violation("23514", "schedule_exceptions_one_subject"),
    );
    // A closed row may not carry hours; an open override must.
    await assert.rejects(
      db.execute(row("1", "NULL", "true", "'10:00'", "'14:00'")),
      violation("23514", "schedule_exceptions_hours_match_closed"),
    );
    await assert.rejects(
      db.execute(row("1", "NULL", "false", "NULL", "NULL")),
      violation("23514", "schedule_exceptions_hours_match_closed"),
    );
    // Override hours must sit on whole minutes.
    await assert.rejects(
      db.execute(row("NULL", "'mimi'", "false", "'10:00:30'", "'14:00'")),
      violation("23514", "schedule_exceptions_opens_at_minute"),
    );
    // A non-existent business (the singleton holds only id 1) and staff.
    await assert.rejects(
      db.execute(row("2", "NULL", "true", "NULL", "NULL")),
      violation("23503"),
    );
    await assert.rejects(
      db.execute(row("NULL", "'ghost'", "true", "NULL", "NULL")),
      violation("23503"),
    );
  });
});

test("staff_schedules enforces weekday/window/minute bounds and the composite key", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await seedSubjects(db);
    const row = (
      staff: string,
      weekday: number,
      window: number,
      opens: string,
    ) =>
      sql`INSERT INTO staff_schedules
        (staff_id, weekday, window_index, opens_at, closes_at)
        VALUES (${staff}, ${weekday}, ${window}, ${opens}, '18:00')`;
    await db.execute(row("mimi", 1, 0, "09:00"));
    // Duplicate composite key.
    await assert.rejects(
      db.execute(row("mimi", 1, 0, "09:00")),
      violation("23505"),
    );
    // Weekday out of 0..6.
    await assert.rejects(
      db.execute(row("mimi", 7, 0, "09:00")),
      violation("23514", "staff_schedules_weekday_range"),
    );
    // Negative window index.
    await assert.rejects(
      db.execute(row("mimi", 2, -1, "09:00")),
      violation("23514", "staff_schedules_window_index_nonnegative"),
    );
    // Opening time off a whole minute.
    await assert.rejects(
      db.execute(row("mimi", 3, 0, "09:00:30")),
      violation("23514", "staff_schedules_opens_at_minute"),
    );
    // Unknown staff member.
    await assert.rejects(
      db.execute(row("ghost", 4, 0, "09:00")),
      violation("23503"),
    );
  });
});
