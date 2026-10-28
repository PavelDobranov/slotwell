// Public interface of the availability capability: the application availability
// read and its input/output contracts. Route registration lives in the HTTP
// adapter (src/server/http/availability.routes.ts); the pure calculator
// (./compute) and the query helpers (./queries) stay private. Internal files
// import ./queries or ./compute directly, not this barrel.

export type {
  AvailabilityQuery,
  AvailabilityView,
} from "@/server/availability/queries";
export { readAvailability } from "@/server/availability/queries";
