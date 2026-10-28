import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";

import type { CatalogDatabase } from "@/server/catalog";
import { registerCatalogRoutes } from "@/server/http/catalog.routes";

// Focused transport coverage for the extracted catalog adapter: the db
// resolution and error mapping that live in HTTP, in isolation from any
// database. The full read behavior and error matrix run through the app in
// catalog.db-test.ts.

type Env = { Bindings: { db?: CatalogDatabase } };

function request(db?: CatalogDatabase) {
  const app = new Hono<Env>();
  registerCatalogRoutes(app);
  return (path: string) => app.request(path, {}, db ? { db } : undefined);
}

test("catalog route reports catalog_unavailable when no database is bound", async () => {
  const res = await request()("/catalog");
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), {
    error: { code: "catalog_unavailable" },
  });
});

test("staff route resolves the database only after a valid selection", async () => {
  // Validation passes, so the absent database surfaces as catalog_unavailable.
  const res = await request()("/staff?service=cut_w");
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), {
    error: { code: "catalog_unavailable" },
  });
});

test("staff route rejects a missing selection before resolving a database", async () => {
  const res = await request()("/staff");
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: { code: "services_required" } });
});

test("an unexpected read failure is mapped to a generic internal error", async () => {
  const exploding = {
    select() {
      throw new Error("boom");
    },
  } as unknown as CatalogDatabase;
  const res = await request(exploding)("/catalog");
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: { code: "internal" } });
});
