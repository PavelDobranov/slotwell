# ADR-005: Separate appointment instants from local scheduling rules

## Status
Accepted

## Date
2026-10-27

## Context
M1 serves one business location, but future locations may operate in different
time zones. The user confirmed that storage and scheduling must not assume a
particular country or European time zone. PostgreSQL is the agreed database.

## Decision
Store appointment start/end instants as PostgreSQL `timestamptz`, and preserve
the booking's IANA time-zone identifier separately. PostgreSQL normalizes these
instants but does not retain the original zone name.

Represent recurring schedules using weekdays and local clock times, and dated
exceptions using local calendar dates and optional local hours. Resolve those
rules in the configured business time zone for the requested date.

Use ISO 8601 timestamps with explicit offsets in APIs, preferably UTC. Keep
interface formatting separate from storage and scheduling. Europe/Sofia may be
seed data, not an application-wide scheduling assumption.

For M1, exclude nonexistent or ambiguous local appointment start times rather
than silently selecting an interpretation.

## Business Rationale
Clients book against the business's local hours. A recurring opening time must
remain the same local clock time when daylight-saving offsets change, while a
confirmed appointment must identify an exact instant.

Separating these concepts supports future locations in other zones without
reinterpreting existing appointment timestamps. Preserving the booking's zone
also avoids relying on the viewer's or database session's current time zone to
explain the appointment.

## Alternatives Considered
- Store appointment times as unzoned local timestamps: cannot uniquely identify
  an instant during repeated clock times.
- Store only UTC values for schedules: would not preserve recurring local hours
  across daylight-saving changes.
- Use fixed UTC offsets as zone identifiers: offsets do not encode a location's
  daylight-saving rules.

## Consequences
- Scheduling tests must cover multiple IANA zones and daylight-saving boundaries.
- Time-zone conversion must be explicit; machine-local defaults cannot define
  booking behavior.
- Multiple locations are still outside M1. This record establishes time semantics,
  not location tables, location selection, or a multi-location scheduling model.
- Exact schedule-boundary handling and future time-zone-rule changes still need
  detailed specification; this record does not settle them by implication.

## Reference
[PostgreSQL date/time types](https://www.postgresql.org/docs/current/datatype-datetime.html)
