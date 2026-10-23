# Product brief

We are building slotwell, a local-first single-business scheduling demo.

Users:
- Exactly one Owner account. Owner-only administration, enforced server-side.
- Staff are records of people who perform services, NOT login accounts.
- Guests book without accounts; there is no client portal/history.

Owner can:
- Create/edit/deactivate services: name, duration, optional display price
  and currency, optional cleanup buffer. Price is display-only; no payments.
- Create/edit staff records and assign service competencies.
- Set recurring weekly business and staff hours.
- View an appointment list and cancel appointments.

Guest flow:
- Choose ONE service → ONE qualified named staff member → available time
  → required name, phone and email, optional notes → confirm.
- Auto-confirm immediately; no slot holds. The first valid confirmation
  wins a conflict; a losing guest gets fresh availability.
- Receive confirmation email in a local mail sink.
- View current appointment status and cancel through a protected,
  appointment-scoped secret link. A phone number alone never authorizes access.
- Cancellation has no cutoff and releases capacity. States are only
  Confirmed and Cancelled. Repeated cancellation must behave safely.

Availability and data:
- Intersect weekly business/staff hours, competency, occupied intervals,
  the service duration/buffer, minimum lead time (default 1 hour), and
  booking horizon (default 60 days). No settings dashboard is required.
- One explicit business time zone, no overnight hours. Clarify slot interval,
  DST treatment and exact boundary rules before implementing availability.
- Transactionally revalidate capacity at confirmation. Retries must not
  create duplicate bookings or email intents. Test real SQLite contention.
- Normalize phone numbers under an agreed region policy. A known phone
  identifies one client record; changed name/email update that record,
  but never disclose prior details to a guest. Decide appointment-contact
  history separately before storing bookings.
- Keep stable references and snapshots of service/duration/price/buffer
  captured at booking. Catalog edits affect bookings created afterward,
  not existing appointments, including ones scheduled in the future.
- Do not hard-delete referenced records. Before enabling schedule or
  competency edits that conflict with bookings, agree a narrow explicit
  policy, preferably reject-and-explain rather than a resolution subsystem.

Email:
- Persist confirmation intent atomically with the booking. An explicit
  command in the same codebase delivers to a local mail sink.
- Delivery failure does not reverse a booking. Show pending/failure state
  and permit retry; document ambiguous-send limits, not exactly-once claims.
- Handle delayed processing of already-cancelled bookings without sending
  a misleading confirmation. No SMS, reminders, or change emails.

Out of scope:
- Staff accounts/invitations, multiple Owners, client accounts, payments,
  multiple businesses, multiple services/staff per appointment, time-first
  booking, any-available assignment, load balancing, dated exceptions,
  blocks, overnight hours, rescheduling, cutoff settings, manual phone-in
  booking, calendar widgets, Completed/No-show, staff deactivation queues,
  live messaging providers, hosted workers, and production readiness.
- Cancelling then booking again is two separate actions, not an atomic move;
  the new slot is not guaranteed. Do not prebuild deferred features.

Stack:
- Strict TypeScript; one Next.js App Router application, Node.js runtime.
- Hono under /api within Next.js, not a separate backend deployment.
- shadcn/ui + Tailwind; local React state first, Context for shared UI state.
- TanStack Query for frontend fetching/caching/mutations, NOT backend storage.
  Do not duplicate server-data caches in Context.
- SQLite + Drizzle migrations; one app instance, persistent ignored DB file.
- Vitest, real SQLite integration tests, and Playwright.

Working boundaries:
- Synthetic data, local email, no secrets committed. Public source publication,
  pushing, live sending, deployment and destructive operations need permission.
- Small iterations, one task at a time, explicit spec/plan/acceptance gates.
  Resolve blocking questions just in time; propose small approved corrections
  when design gaps appear. Do not freeze the whole schema in advance.
- I have performed the initial scaffold by hand using official documentation.
  Read README and docs/setup-baseline.md, inspect the actual files and lockfile,
  and verify the recorded baseline. Do not regenerate the application, replace
  setup configuration from memory, or install/upgrade packages without approval.
- Plans and task state belong in GitHub Issues through gh. No tasks/plan.md
  or tasks/todo.md. I will supply the tracker rules before issue operations.