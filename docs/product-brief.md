# Slotwell — product brief

**Slotwell** is a scheduling web app for a **single business**. Clients book appointments
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
- **Client** — books via the wizard as a guest. Identified uniquely by **phone number**;
  provides name, phone, and **email** (all required).

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
   - **Path A — staff-first:** pick a specific staff member (or **"any available"**).
   - **Path B — time-first:** pick a date & time.
3. **Complete the pair (conditional on step 2):**
   - After Path A → choose a date & time from that staff member's open **slots**.
   - After Path B → choose from the qualified staff free at that time (or **"any available"**).
4. **Your details** — name, phone, and email (all required), optional notes.
5. **Confirm** — appointment is **auto-confirmed** immediately.

Rules:

- A time is a **bookable slot** when it falls within business open hours **and** the
  chosen staff member's working hours, that staff member handles **all** chosen
  services, and they are free for the full duration (+ buffers). The same rule applies
  in both paths — only the order of narrowing differs.
- **"Any available"** assigns a concrete staff member at confirmation, load-balanced by
  that day's booking count (ties → first eligible). Offered in both paths.
- **Booking horizon:** up to **60 days** ahead (configurable).
- **Minimum lead time:** at least **1 hour** before start (configurable).
- **Concurrency:** first to confirm wins; a client who loses the race is re-shown live
  availability. Slots are not held during the wizard.
- All times are in the business's **single fixed time zone**.

## 4. Client self-service after booking

- Via a link (tied to their phone), a client can **cancel** or **reschedule** their own
  appointment.
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

Sent to the client's required **email address**. Phone remains required for client
identity and contact, but no SMS messages are sent; SMS notifications are out of scope
for the MVP.

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
- On a known phone with a new name or email, the record is treated as the **same
  client** and the stored name/email are overwritten (phone is identity; email is
  contact only).

## 9. Explicitly out of scope for the MVP

- Online payments / deposits (price is display-only).
- Client accounts / login / self-service history.
- Multi-tenant / multiple businesses.
- Multiple staff within one appointment.
- Authentication: owner/staff accounts, login/logout, passwords, and staff invitations
  (deferred beyond the initial version).
- Role-based access and staff-only access to their own records (deferred).
- Multiple **Owner**-level admins.
- SMS notifications.
- Per-client channel preference (email is the only notification channel).
- Multiple reminders per appointment.
- Slot-holding / reservation timeouts.
- Email as a client **identifier** (email is contact only; phone is identity).