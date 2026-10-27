import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Hono } from "hono";

import { businessSettings, services, staff, staffServices } from "@/db/schema";

// Reads only; a structural handle accepts the app pool and the test harness's
// held private-schema connection alike.
export type CatalogDatabase = Pick<NodePgDatabase, "select">;

// Bound the qualified-staff request. M1 seeds 12 services; 20 leaves headroom
// without accepting unbounded selections.
export const MAX_SELECTED_SERVICES = 20;
const MAX_SERVICE_ID_LENGTH = 64;

export type BusinessView = {
  name: string;
  address: string;
  timeZone: string;
  currency: string;
};
export type ServiceView = {
  id: string;
  name: string;
  category: string;
  priceCents: number | null;
  durationMinutes: number;
};
export type StaffView = {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
};
export type CatalogView = {
  business: BusinessView;
  services: ServiceView[];
};

// Stable machine-readable failure; never leaks whether an identifier is unknown
// versus deactivated, nor any non-allowlisted record field.
export class CatalogError extends Error {
  readonly code: string;
  readonly status: number;
  readonly serviceIds?: string[];
  readonly max?: number;
  constructor(
    code: string,
    status: number,
    extra?: { serviceIds?: string[]; max?: number },
  ) {
    super(code);
    this.code = code;
    this.status = status;
    this.serviceIds = extra?.serviceIds;
    this.max = extra?.max;
  }
  body() {
    const error: Record<string, unknown> = { code: this.code };
    if (this.serviceIds) error.serviceIds = this.serviceIds;
    if (this.max !== undefined) error.max = this.max;
    return { error };
  }
}

/** Business identity plus active services, ordered for the picker. */
export async function readCatalog(db: CatalogDatabase): Promise<CatalogView> {
  const [business] = await db
    .select({
      name: businessSettings.name,
      address: businessSettings.address,
      timeZone: businessSettings.timeZone,
      currency: businessSettings.currency,
    })
    .from(businessSettings)
    .where(eq(businessSettings.id, 1));
  if (!business) {
    throw new CatalogError("catalog_unavailable", 500);
  }
  const serviceRows = await db
    .select({
      id: services.id,
      name: services.name,
      category: services.category,
      priceCents: services.priceCents,
      durationMinutes: services.durationMinutes,
    })
    .from(services)
    .where(eq(services.isActive, true))
    .orderBy(services.sortOrder);
  return { business, services: serviceRows };
}

/**
 * Validate the raw `service` query array against the approved bounds. Pure, so
 * the handler can reject malformed requests before resolving a database.
 */
export function validateServiceSelection(raw: string[] | undefined): string[] {
  if (!raw || raw.length === 0) {
    throw new CatalogError("services_required", 400);
  }
  if (raw.length > MAX_SELECTED_SERVICES) {
    throw new CatalogError("too_many_services", 400, {
      max: MAX_SELECTED_SERVICES,
    });
  }
  if (raw.some((id) => id.length === 0 || id.length > MAX_SERVICE_ID_LENGTH)) {
    throw new CatalogError("invalid_service_id", 400);
  }
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of raw) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size > 0) {
    throw new CatalogError("duplicate_services", 400, {
      serviceIds: [...duplicates],
    });
  }
  return raw;
}

/**
 * Active staff qualified for EVERY distinct selected active service. Expects an
 * already-validated, distinct `serviceIds` (see `validateServiceSelection`).
 */
export async function readQualifiedStaff(
  db: CatalogDatabase,
  serviceIds: string[],
): Promise<StaffView[]> {
  const active = await db
    .select({ id: services.id })
    .from(services)
    .where(and(inArray(services.id, serviceIds), eq(services.isActive, true)));
  const known = new Set(active.map((row) => row.id));
  const unknown = serviceIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new CatalogError("unknown_services", 400, { serviceIds: unknown });
  }
  // GROUP BY the PK lets Postgres project the functionally dependent columns;
  // HAVING the full count keeps only staff covering every selected service.
  return db
    .select({
      id: staff.id,
      name: staff.name,
      description: staff.description,
      imageUrl: staff.imageUrl,
    })
    .from(staff)
    .innerJoin(staffServices, eq(staffServices.staffId, staff.id))
    .where(
      and(
        eq(staff.isActive, true),
        inArray(staffServices.serviceId, serviceIds),
      ),
    )
    .groupBy(staff.id)
    .having(
      sql`count(distinct ${staffServices.serviceId}) = ${serviceIds.length}`,
    )
    .orderBy(staff.sortOrder);
}

type CatalogBindings = { Bindings: { db?: CatalogDatabase } };

/**
 * Routes read the db from `c.env.db`: the Next adapter injects the server-only
 * app database, tests inject a harness connection. This module imports no
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
