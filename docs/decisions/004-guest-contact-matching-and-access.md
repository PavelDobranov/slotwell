# ADR-004: Separate guest contact matching from appointment access

## Status
Accepted

## Date
2026-10-27

## Context
Slotwell supports guest booking without client accounts. Staff need a name and
contact details for each appointment, and the business wants to recognize possible
returning clients. Entering a name, phone, or email does not prove ownership of
those details. Phone numbers can be shared, mistyped, or reassigned.

## Decision
Use a stable internal client ID and normalized international phone numbers for
internal returning-client matching. Collect one name field, phone, and email;
do not require a fixed number of name parts or merge clients by name or email.

Preserve submitted contact details on each appointment. A matching phone does not
allow a guest to retrieve an existing client's details or overwrite their contact
profile. Scope guest access to a specific appointment through an unguessable access
link, not through entered contact fields. Confirmation retrieval belongs to M1;
client cancellation and rescheduling remain M5 capabilities.

## Business Rationale
This keeps booking simple and account-free while giving staff the contact details
provided for the particular visit. Separating contact matching from authorization
prevents a returning-client convenience from becoming a way to expose previous
bookings or modify another person's contact profile.

A single name field supports the name the client uses without treating additional
name parts as stronger identity evidence.

## Alternatives Considered
The original brief overwrote stored name/email on a matching phone. The agreed
approach preserves the existing profile because an unverified submission cannot
safely establish who is requesting that change. Requiring verification at booking
would introduce an additional workflow not selected for this MVP.

## Consequences
- Phone-based matches are possible-client associations, not verified person identity.
- Appointment communications use that appointment's submitted contact details rather
  than changes made by a later guest booking.
- Contact validation, matching, and authorization need distinct tests.
- Token lifecycle and profile correction procedures still need specification; this
  record does not invent those policies or claim they are implemented.
- The product brief owns the detailed product rules. This decision supersedes its
  former guest contact-overwrite policy.
