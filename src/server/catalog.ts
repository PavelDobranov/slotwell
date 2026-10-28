// Temporary compatibility shim. The catalog capability now lives in
// src/server/catalog/ with its public interface in ./catalog/index.ts. This
// flat path preserves the pre-migration `@/server/catalog` surface for
// consumers not yet rewired; it is removed once they move to the public
// interface (shared selection rules and the catalog use cases) in the final
// consumer/test relocation (#105).
//
// Beyond the public interface, this re-exports the transitional selection
// utilities still imported from here — `validateServiceSelection`
// (book-appointment, availability-query, catalog.routes, catalog.test) and
// `MAX_SELECTED_SERVICES` (booking-routes, catalog.test) — which relocate with
// those consumers in #105.

export type {
  BusinessView,
  CatalogDatabase,
  CatalogView,
  ServiceView,
  StaffView,
} from "@/server/catalog/use-cases";
export {
  CatalogError,
  MAX_SELECTED_SERVICES,
  readCatalog,
  readQualifiedStaff,
  validateServiceSelection,
} from "@/server/catalog/use-cases";
