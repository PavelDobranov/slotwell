// Public interface of the catalog capability: the read use cases, their
// input/output contracts, and the application error. Route registration lives
// in the HTTP adapter (src/server/http/catalog.routes.ts); the shared
// service-selection rule and its count bound live in @/shared/service-selection.
// Internal files import ./use-cases directly, not this barrel.

export type {
  BusinessView,
  CatalogDatabase,
  CatalogView,
  ServiceView,
  StaffView,
} from "@/server/catalog/use-cases";
export {
  CatalogError,
  readCatalog,
  readQualifiedStaff,
} from "@/server/catalog/use-cases";
