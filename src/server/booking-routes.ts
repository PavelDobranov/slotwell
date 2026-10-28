// Temporary compatibility shim. The booking HTTP adapter now lives in
// src/server/http/booking.routes.ts, alongside the catalog and availability
// routes; it consumes the booking capability only through its public interface
// (@/server/booking) and reads transport origin/cookie policy from
// @/server/http/booking-configuration.
//
// This flat path preserves the pre-migration `@/server/booking-routes` surface
// for the colocated route tests still importing it from here
// (booking-routes.db-test); it is removed once they move to the HTTP adapter in
// the final consumer/test relocation (#105).

export {
  type BookingDatabase,
  registerBookingRoutes,
} from "@/server/http/booking.routes";
