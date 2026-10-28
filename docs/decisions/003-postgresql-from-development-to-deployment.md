# ADR-003: Use PostgreSQL from development through deployment

## Status
Accepted

## Date
2026-10-27

## Context
At decision time, the scaffold used SQLite. The agreed final target was Cloud Run with managed PostgreSQL and a fresh seeded database, not imported demo records. The user wanted M1 focused on booking rather than cloud infrastructure.

## Decision
Use PostgreSQL for persisted booking across environments, with migrations and repeatable seeds:
- **M1:** local application and PostgreSQL.
- **M2:** application and self-operated PostgreSQL on a Google Cloud VM for demos.
- **Final direction:** Cloud Run with managed PostgreSQL, freshly seeded; no delivery milestone assigned here.

The decision required replacing the SQLite scaffold; this is historical rationale, not a claim about the current implementation. GitHub owns delivery status.

## Business Rationale
One engine avoids reworking/reverifying booking transactions and constraints during a later conversion. Local M1 avoids cloud setup; the VM demo postpones a separately managed database.

## Alternatives Considered
- SQLite first: lower initial cost, but a known conversion later.
- Cloud during M1: earlier shared demos, but work the user deferred to M2.

## Consequences
Acceptance and concurrency tests must exercise PostgreSQL. M2 requires secure access, persistent storage, and backup/recovery; its database is operated by us. Cloud Run still needs deployment verification, but not an engine conversion or demo-data transfer. Sizing, tooling, costs, and managed-service configuration belong to implementation planning.
