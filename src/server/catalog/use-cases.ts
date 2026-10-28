import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { businessSettings, services, staff, staffServices } from "@/db/schema";
import {
  ServiceSelectionError,
  validateServiceSelection as validateSelectionRule,
} from "@/shared/service-selection";

// The count bound is part of the shared selection policy, not a catalog
// internal. Re-exported here so existing catalog consumers keep one import site
// while the rule itself is owned by the shared selection module.
export { MAX_SELECTED_SERVICES } from "@/shared/service-selection";

// Reads only; a structural handle accepts the app pool and the test harness's
// held private-schema connection alike.
export type CatalogDatabase = Pick<NodePgDatabase, "select">;

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
 * the handler can reject malformed requests before resolving a database. The
 * bounds/de-duplication policy lives in the shared selection rule; this wrapper
 * only translates its transport-independent failure into the catalog's HTTP
 * error, keeping existing response bodies unchanged.
 */
export function validateServiceSelection(raw: string[] | undefined): string[] {
  try {
    return validateSelectionRule(raw);
  } catch (error) {
    if (error instanceof ServiceSelectionError) {
      throw new CatalogError(error.code, 400, {
        serviceIds: error.serviceIds,
        max: error.max,
      });
    }
    throw error;
  }
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
