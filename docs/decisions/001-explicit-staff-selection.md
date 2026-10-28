# ADR-001: Clients choose the staff member for their appointment

## Status
Accepted

## Date
2026-10-27

## Context
Clients may prioritize a specialist or an appointment time. The user confirmed explicit staff choice in both routes, matching the accepted frontend prototype (#2).

## Decision
After services, support staff-first (staff → time) and time-first (time → staff) navigation. Require explicit selection of one concrete qualified/available staff member even when only one is eligible; carry that choice through review and confirmation.

## Business Rationale
Navigation order can vary without surrendering the client's choice or introducing an assignment policy.

## Alternatives Considered
The original roadmap's “any available” option and automatic assignment/load balancing are not required for Version 1.

## Consequences
Both routes share qualification/availability rules: one staff member must cover every service and occupied interval, including buffers. Confirmation rechecks availability and prevents overlapping concurrent bookings; selection is not a slot hold. This product decision is not delivery evidence; milestone scope belongs to GitHub.
