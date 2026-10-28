# ADR-004: Separate guest contact matching from appointment access

## Status
Accepted

## Date
2026-10-27

## Context
Guest contact fields do not prove identity/ownership; phones may be shared, mistyped, or reassigned. The business still needs visit-specific contact details and possible-returning-client matching.

## Decision
Match normalized international phone numbers to stable internal client IDs. Collect one name field, phone, and email; no fixed name-part count or automatic name/email merging.

Preserve submitted contacts on each appointment. A match grants neither access to stored details nor permission to overwrite the client profile. Guest access uses an unguessable appointment-specific link, not contact fields. Confirmation retrieval belongs to M1; cancellation/rescheduling remain M5 scope.

## Business Rationale
Keep account-free booking convenient without exposing history or allowing an unverified guest to alter another person's profile. Additional name parts are not stronger identity evidence.

## Alternatives Considered
The original brief overwrote name/email on a matching phone. This is unsafe without ownership verification; adding verification at booking was not selected for the MVP.

## Consequences
Communications use the appointment's submitted details, not later guest changes. Test validation, matching, and authorization separately. This supersedes the former contact-overwrite policy.

This ADR does not define profile-correction policy or private-link transport. Backend replay/expiry/retention obligations are specified in the [retry contract](../contracts/booking-retries.md); active tasks own remaining scope and delivery status.
