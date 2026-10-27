# ADR-002: Book services at one business location

## Status
Accepted

## Date
2026-10-27

## Context
Version 1 serves one business operating at one location. The booking experience
therefore has a known destination and a single business time zone.

The user considered location selection before or within the wizard and confirmed
keeping the current single-location experience to preserve MVP simplicity.

## Decision
Treat the business's location as context for the booking, not a choice the client
must make. Display the business address in the wizard and use the business's fixed
time zone for scheduling.

The wizard starts with services, followed by time/staff selection, client details,
and review. Clients can reach this flow without completing a location-selection
prerequisite.

Keep business details centralized and scheduling logic separate from presentation
as an implementation direction. Centralizing business identity is also tracked
in issue #52; this record does not claim that work is already complete.

## Business Rationale
With only one destination, a location-selection step would ask clients to make a
choice that cannot change their booking. Showing the address provides the relevant
information while keeping the flow focused on services, staff, and time.

This keeps the MVP matched to the current business model without introducing
relationships for additional locations before their requirements are known.

## Alternatives Considered
A location picker or location-specific entry links could support a business with
multiple locations. They are unnecessary for the agreed single-location flow;
a future multi-location requirement would need its own specification.

## Consequences
- All Version 1 appointments take place at the same business location.
- The address and business-local appointment time provide a consistent destination
  and time reference throughout booking review and confirmation.
- Implementation can use the current single-location model without speculative
  location tables, routing, or selection state.
- Adding locations later may require migrating existing records and defining how
  staff, services, hours, and appointments relate to each location. This decision
  favors present simplicity, not a guarantee of cost-free expansion.
