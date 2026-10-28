import type { Hono } from "hono";

import {
  type CatalogDatabase,
  CatalogError,
  readCatalog,
  readQualifiedStaff,
  validateServiceSelection,
} from "@/server/catalog";

type CatalogBindings = { Bindings: { db?: CatalogDatabase } };

/**
 * Routes read the db from `c.env.db`: the Next adapter injects the server-only
 * app database, tests inject a harness connection. This adapter imports no
 * driver, so the Hono CLI can load the app to inspect routes and validation.
 */
export function registerCatalogRoutes(app: Hono<CatalogBindings>) {
  const resolve = (c: { env?: { db?: CatalogDatabase } }): CatalogDatabase => {
    if (!c.env?.db) throw new CatalogError("catalog_unavailable", 500);
    return c.env.db;
  };
  const fail = (error: unknown) => {
    if (error instanceof CatalogError) {
      return { status: error.status as 400 | 500, body: error.body() };
    }
    return { status: 500 as const, body: { error: { code: "internal" } } };
  };

  app.get("/catalog", async (c) => {
    try {
      return c.json(await readCatalog(resolve(c)));
    } catch (error) {
      const { status, body } = fail(error);
      return c.json(body, status);
    }
  });

  app.get("/staff", async (c) => {
    try {
      // Validate the request before resolving a database.
      const serviceIds = validateServiceSelection(c.req.queries("service"));
      const staffView = await readQualifiedStaff(resolve(c), serviceIds);
      return c.json({ staff: staffView });
    } catch (error) {
      const { status, body } = fail(error);
      return c.json(body, status);
    }
  });

  return app;
}
