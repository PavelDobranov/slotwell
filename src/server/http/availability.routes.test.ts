import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";

import type { CatalogDatabase } from "@/server/catalog";
import { registerAvailabilityRoutes } from "@/server/http/availability.routes";

// Focused transport coverage for the extracted availability adapter: the
// no-store header, the query-shape validation, and the missing-database
// mapping, in isolation from any database. The full read behavior and the
// complete malformed-request matrix run through the app in availability.db-test.ts.

const VALID = "staff=mimi&service=cut_w&from=2026-06-01&to=2026-06-01";

function request(db?: CatalogDatabase) {
  const app = new Hono<{ Bindings: { db?: CatalogDatabase } }>();
  registerAvailabilityRoutes(app);
  return (query: string) =>
    app.request(`/availability?${query}`, {}, db ? { db } : undefined);
}

test("availability route always sets Cache-Control: no-store", async () => {
  const res = await request()(VALID);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("a valid query with no database bound reports availability_unavailable", async () => {
  const res = await request()(VALID);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), {
    error: { code: "availability_unavailable" },
  });
});

test("an unknown query key is rejected as invalid_query before database access", async () => {
  const res = await request()(`${VALID}&price=0`);
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { error: { code: "invalid_query" } });
});

test("a non-singular staff parameter is rejected as invalid_staff_id", async () => {
  const res = await request()(`${VALID}&staff=pavel`);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: { code: "invalid_staff_id" } });
});

test("a window wider than the endpoint bound is rejected with the max", async () => {
  const res = await request()(VALID.replace("to=2026-06-01", "to=2026-06-08"));
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), {
    error: { code: "date_range_too_large", max: 7 },
  });
});
