# ADR-005: Separate appointment instants from local scheduling rules

## Status
Accepted

## Date
2026-10-27

## Context
One-location M1 must not hard-code a country/European zone; future locations may use other zones. Business-local recurring hours and confirmed appointment instants have different semantics.

## Decision
Store appointment start/end as PostgreSQL `timestamptz` and separately preserve the booking's IANA zone; PostgreSQL does not retain the zone name. Represent weekly hours as weekdays/local clock times and exceptions as local dates/optional hours. Resolve these rules in the configured business zone for the requested date.

APIs use ISO 8601 instants with explicit offsets, preferably UTC; display formatting stays separate. Europe/Sofia may be seed data, never an application-wide assumption. M1 excludes nonexistent/ambiguous local appointment starts rather than silently choosing an interpretation.

## Business Rationale
Local opening times must survive DST offset changes, while appointments identify exact instants. Preserving the booking zone avoids reinterpretation through viewer/database-session defaults and supports future zone expansion.

## Alternatives Considered
Unzoned appointment timestamps cannot distinguish repeated times; UTC-only schedules lose recurring local hours across DST; fixed offsets do not encode daylight-saving rules.

## Consequences
Use explicit conversion and tests across IANA zones/DST boundaries, never machine-local scheduling defaults. This does not authorize multi-location data models. The ADR alone does not settle exact schedule-boundary handling or future time-zone-rule changes; consult the scoped specification/contract rather than infer policy.

## Reference
[PostgreSQL date/time types](https://www.postgresql.org/docs/current/datatype-datetime.html)
