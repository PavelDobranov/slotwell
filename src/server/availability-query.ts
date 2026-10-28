// Temporary compatibility shim. The callable availability read now lives in
// src/server/availability/queries.ts (a private module internal), reached by
// consumers through the public interface in ./availability/index.ts.
//
// This flat path preserves the pre-migration `@/server/availability-query`
// surface (readAvailability and its contracts) for consumers not yet rewired —
// book-appointment, the availability DB test, and the HTTP adapter. They move to
// the public `@/server/availability` interface when this shim is removed in the
// final consumer/test relocation (#105).

export * from "@/server/availability/queries";
