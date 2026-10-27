# Slotwell — product brief

**Slotwell** is a scheduling web app for a **single business at one location**. Clients book appointments
through a self-service wizard; the business manages the calendar, services, and schedules
through an admin area. This document is for validating scope with the client before build.

**Initial version (MVP):** email notifications only. Authentication, staff invitations,
and role-based access are deferred. The admin area is for a trusted development/demo
environment; it must not be publicly exposed without access protection.

## 1. Who uses it

The initial version has a business operator, staff records, and guest clients — no
user accounts or login.

- **Business operator (Owner)** — manages the **service catalog**, **staff roster**,
  **all-staff calendar**, and schedules and appointments for any staff member.
- **Staff** — a person who performs services, represented by a record rather than a
  login account. Has **working hours**, **exceptions**, **service competencies**
  (which catalog services they handle), and **appointments**, managed through the admin
  area. Separate staff access and owner/staff permissions are deferred.
- **Client** — books via the wizard as a guest and has a stable internal client ID.
  Provides name, phone, and **email** (all required). A normalized international phone
  number matches a possible returning client; it does not prove identity or ownership.
  Use one name field without requiring a fixed number of name parts.

## 2. Core concepts

- **Service** — name, typical duration, optional price (shown, not charged), optional
  cleanup **buffer**.
- **Staff** — name, the set of services they can perform, a recurring weekly
  **working-hours** schedule, and dated **exceptions** (time off / holidays / early leave).
- **Appointment** — one client + one staff member + one or more services, at a date/time.
  Duration = sum of the services' durations, run as one contiguous block.
- **Block** — non-client time on a staff member's calendar (lunch, meeting, personal).

## 3. Client booking wizard

The wizard always starts with services, then **forks** so the client narrows by
whichever they care about first — a specialist or a time.

1. **Service(s)** — pick one or more.
2. **Choose your route:**
   - **Path A — staff-first:** pick a specific staff member.
   - **Path B — time-first:** pick a date & time.
3. **Complete the pair (conditional on step 2):**
   - After Path A → choose a date & time from that staff member's open **slots**.
   - After Path B → explicitly choose a specific qualified staff member free at that time.
4. **Your details** — name, phone, and email (all required), optional notes.
   Limits: name 100 characters, phone 32 before normalization, email 254, notes 1,000.
5. **Confirm** — appointment is **auto-confirmed** immediately.

Rules:

- A time is a **bookable slot** when it falls within business open hours **and** the
  chosen staff member's working hours, that staff member handles **all** chosen
  services, and they are free for the full duration (+ buffers). The same rule applies
  in both paths — only the order of narrowing differs.
- Clients explicitly choose a concrete staff member in both paths, even when only one
  is eligible. **"Any available"** and automatic staff assignment are outside the MVP.
- The business has one location. Show its address in the wizard; do not add a location
  picker or a location-selection prerequisite.
- **Booking horizon:** up to **60 days** ahead (configurable).
- **Minimum lead time:** at least **1 hour** before start (configurable).
- **Concurrency:** first to confirm wins; a client who loses the race is re-shown live
  availability. Slots are not held during the wizard.
- Scheduling uses the business's **configured IANA time zone**, not the device's
  time zone. Store appointment start/end instants as PostgreSQL `timestamptz` and
  preserve the booking's IANA zone separately. Weekly hours and dated exceptions
  remain local scheduling rules; display formatting is separate. M1 excludes
  nonexistent or ambiguous local start times.

## 4. Client self-service after booking

- Via an unguessable, appointment-specific access link, a client can **cancel** or
  **reschedule** that appointment. Entering name, phone, or email does not grant access
  to existing bookings; a link does not grant access to the client's other appointments.
- An optional client-side **cutoff** can forbid changes within N hours of the start
  (default: none in the MVP).

## 5. Admin area (authentication deferred)

The initial version has no login or role-based restrictions. The business operator can
manage all staff through the same admin area. Owner/staff accounts and staff-only access
to their own records are deferred.

**Business management:**

- **Service catalog** — create/edit services (name, duration, price, buffer).
- **Staff roster** — add/edit staff records with a name and email. No invitations,
  passwords, or login accounts in the initial version.
- **All-staff calendar** — view every staff member's appointments and blocks.
- **Act for anyone** — create/cancel/reschedule appointments, add blocks, and mark
  outcomes for any staff member.

**Per-staff management (operator selects a staff member):**

- **Staff calendar** — view the selected staff member's appointments and blocks.
- **Create** an appointment manually (phone-in bookings).
- **Cancel / reschedule** appointments (no cutoff for admin changes).
- **Block** off time.
- **Mark outcomes** — set a past appointment to **Completed** or **No-show**.
- **Working hours & exceptions** — edit recurring schedules and dated overrides.
- **Service competencies** — choose which catalog services the staff member handles.

## 6. Appointment lifecycle

`Confirmed` → **`Completed`** / **`No-show`** / **`Cancelled`**

- New appointments start **Confirmed**.
- The business operator sets **Completed** or **No-show** after the fact for any staff
  member; unmarked past appointments stay Confirmed.
- **Cancelled** may be set by client (via link) or owner.

## 7. Notifications (email only)

Sent to the **email address supplied for the appointment**. Phone remains required
for returning-client matching and contact, but no SMS messages are sent; SMS
notifications are out of scope for the MVP. Format validation of email and phone
is not verification of ownership.

- **Confirmation** — at booking.
- **Reminder** — one, configurable offset, **default 24h** before.
- **Change notice** — on cancel or reschedule.

Staff invitation emails are deferred along with authentication.

## 8. Editing vs. history

- Changing a service's duration/price affects **future** bookings only; past
  appointments keep the values they were booked with.
- Staff and services are **deactivated** (hidden from the wizard), never hard-deleted
  while referenced. Future appointments under a deactivated staff member are **flagged
  for the owner** to reassign or cancel.
- Match a normalized phone to an existing client internally, without revealing that
  client's stored details. Store the submitted name, phone, and email on each new
  appointment. Guest submissions do not overwrite an existing client's contact profile
  or change contact details on earlier appointments. Do not automatically merge clients
  by name or email. Phone matches may represent shared or reassigned numbers, not
  necessarily the same person.

## 9. Explicitly out of scope for the MVP

- Online payments / deposits (price is display-only).
- Client accounts / login / self-service history.
- Multi-tenant / multiple businesses.
- Multiple locations and location selection before or within the wizard.
- "Any available" staff selection and automatic staff assignment.
- Multiple staff within one appointment.
- Authentication: owner/staff accounts, login/logout, passwords, and staff invitations
  (deferred beyond the initial version).
- Role-based access and staff-only access to their own records (deferred).
- Multiple **Owner**-level admins.
- SMS notifications.
- Per-client channel preference (email is the only notification channel).
- Multiple reminders per appointment.
- Slot-holding / reservation timeouts.
- Email-based automatic client merging or access based solely on entered contact details.

## Decision records

- [ADR-001: Clients choose the staff member for their appointment](decisions/001-explicit-staff-selection.md).
- [ADR-002: Book services at one business location](decisions/002-defer-multiple-locations.md).
- [ADR-003: Use PostgreSQL from development through deployment](decisions/003-postgresql-from-development-to-deployment.md).
- [ADR-004: Separate guest contact matching from appointment access](decisions/004-guest-contact-matching-and-access.md).
- [ADR-005: Separate appointment instants from local scheduling rules](decisions/005-timezone-independent-appointment-storage.md).
