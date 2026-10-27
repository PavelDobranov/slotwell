# ADR-001: Clients choose the staff member for their appointment

## Status
Accepted

## Date
2026-10-27

## Context
Slotwell lets clients narrow their booking by whichever matters first: the
specialist or the time. Both routes serve the same outcome: an appointment with
one concrete staff member qualified and available for every selected service.

The user confirmed that choosing that staff member remains an explicit client
action. This matches the accepted frontend prototype (#2).

## Decision
Start with service selection, then support both booking routes:
- **Staff-first:** the client chooses a qualified staff member, then an available
  date and time for that person.
- **Time-first:** the client chooses an available date and time, then a qualified
  staff member available at that time.

Require explicit staff selection in either route, even when only one person is
eligible. Carry the selected staff member through appointment review and confirmation.

## Business Rationale
Clients can prioritize either who performs the services or when the appointment
happens without giving up their choice of staff member. The navigation order
changes, but the appointment and its eligibility rules stay the same.

Keeping assignment explicit also keeps the MVP aligned with the accepted booking
experience rather than adding an automatic-assignment policy.

## Alternatives Considered
Automatic assignment through an “any available” option was part of the original
roadmap. Explicit selection is the agreed behavior instead; automatic assignment
and load balancing are not required for Version 1.

## Consequences
- Both routes use the same qualification and availability rules.
- The selected staff member must handle all services for the entire appointment,
  including its occupied time and buffers.
- Confirmation rechecks availability and prevents concurrent overlapping bookings;
  the client's selection is not a slot hold.
- The product brief and roadmap #1 describe this agreed behavior. This record
  establishes a product rule, not evidence that persisted booking is implemented.
