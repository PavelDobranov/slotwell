import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { businessSettings, services, staff, staffServices } from "@/db/schema";
import { validateServiceSelection } from "@/shared/service-selection";

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
// versus deactivated, nor any non-allowlisted record field. The error carries no
// HTTP status or response body: the HTTP adapter maps the code to a status.
export class CatalogError extends Error {
  readonly code: string;
  readonly serviceIds?: string[];
  readonly max?: number;
  constructor(code: string, extra?: { serviceIds?: string[]; max?: number }) {
    super(code);
    this.code = code;
    this.serviceIds = extra?.serviceIds;
    this.max = extra?.max;
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
    throw new CatalogError("catalog_unavailable");
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

/** Active staff qualified for EVERY distinct selected active service. */
export async function readQualifiedStaff(
  db: CatalogDatabase,
  serviceIds: string[],
): Promise<StaffView[]> {
  validateServiceSelection(serviceIds);
  const active = await db
    .select({ id: services.id })
    .from(services)
    .where(and(inArray(services.id, serviceIds), eq(services.isActive, true)));
  const known = new Set(active.map((row) => row.id));
  const unknown = serviceIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new CatalogError("unknown_services", { serviceIds: unknown });
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
