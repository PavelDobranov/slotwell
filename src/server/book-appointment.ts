// Temporary compatibility shim. The booking transaction implementation now lives
// in src/server/booking/book-appointment.ts as a private internal of the booking
// capability; consumers reach booking through its public interface in
// ./booking/index.ts.
//
// This flat path preserves the pre-migration `@/server/book-appointment` surface
// for the colocated tests still importing it from here (book-appointment.db-test,
// booking-operation.test, booking-operation.db-test, booking-routes.db-test); it
// is removed once they move to the module in the final consumer/test relocation
// (#105).

export * from "@/server/booking/book-appointment";
