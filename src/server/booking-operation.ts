// Temporary compatibility shim. The booking operation and recovery implementation
// now lives in src/server/booking/operations.ts as a private internal of the
// booking capability; consumers reach booking through its public interface in
// ./booking/index.ts.
//
// This flat path preserves the pre-migration `@/server/booking-operation` surface
// for consumers not yet rewired — the colocated operation tests
// (booking-operation.test, booking-operation.db-test) and booking-configuration,
// whose configuration wiring is addressed in #104. They move to the module when
// this shim is removed in the final consumer/test relocation (#105).

export * from "@/server/booking/operations";
