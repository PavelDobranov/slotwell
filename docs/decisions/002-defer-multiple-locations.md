# ADR-002: Book services at one business location

## Status
Accepted

## Date
2026-10-27

## Context
Version 1 serves one business at one location. The user considered location selection and chose the simpler single-location experience.

## Decision
Treat location as booking context, not a choice/prerequisite. Show the address and schedule in the business's configured time zone. Start the wizard with services, not a location picker. Keep business identity centralized and scheduling separate from presentation.

## Business Rationale
A single destination offers no meaningful location choice. Avoid speculative multi-location relationships before requirements are known.

## Alternatives Considered
Location pickers and location-specific entry links could serve future multi-location businesses; they do not serve this MVP.

## Consequences
Review/confirmation must identify the address and business-local time. Do not introduce speculative location tables, routing, or selection state. Expansion may require migrating records and defining staff/service/hour/appointment relationships; present simplicity does not promise cost-free expansion. Business-identity consolidation is tracked in #52, not declared complete here.
