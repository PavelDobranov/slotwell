// Temporary compatibility shim. The availability capability now lives in
// src/server/availability/ with its public interface in ./availability/index.ts
// (the application read and its contracts). The pure calculator now lives in
// ./availability/compute.ts, where it is a private module internal.
//
// This flat path preserves the pre-migration `@/server/availability` calculator
// surface for the colocated pure test still importing it from here; it is
// removed once that test moves to ./availability/compute in the final
// consumer/test relocation (#105).

export * from "@/server/availability/compute";
