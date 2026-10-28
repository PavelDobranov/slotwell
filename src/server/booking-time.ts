// TEMPORARY compatibility shim (M1 #96) — remove at the cleanup checkpoint.
//
// The scheduling-time primitives now live in `@/shared/booking-time` as a pure,
// server-independent library. This re-export keeps existing capability imports
// working without churn; it is not a module public API. New code imports from
// `@/shared/booking-time` directly. Delete this file once all consumers are moved.

export * from "@/shared/booking-time";
