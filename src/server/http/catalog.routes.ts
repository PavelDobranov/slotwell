import type { Hono } from "hono";

import {
  type CatalogDatabase,
  CatalogError,
  readCatalog,
  readQualifiedStaff,
} from "@/server/catalog";
import { catalogErrorResponse } from "@/server/http/catalog-error";
import { validateServiceSelection } from "@/shared/service-selection";

type CatalogBindings = { Bindings: { db?: CatalogDatabase } };

/**
 * Routes read the db from `c.env.db`: the Next adapter injects the server-only
 * app database, tests inject a harness connection. This adapter imports no
 * driver, so the Hono CLI can load the app to inspect routes and validation.
 */
export function registerCatalogRoutes(app: Hono<CatalogBindings>) {
  const resolve = (c: { env?: { db?: CatalogDatabase } }): CatalogDatabase => {
    if (!c.env?.db) throw new CatalogError("catalog_unavailable");
    return c.env.db;
  };

  app.get("/catalog", async (c) => {
    try {
      return c.json(await readCatalog(resolve(c)));
    } catch (error) {
      const { status, body } = catalogErrorResponse(error);
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
      const { status, body } = catalogErrorResponse(error);
      return c.json(body, status);
    }
  });

  return app;
}
