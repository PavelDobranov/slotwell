# ADR-003: Use PostgreSQL from development through deployment

## Status
Accepted

## Date
2026-10-27

## Context
The current database scaffold uses SQLite, but the agreed final deployment target
is Google Cloud Run with managed PostgreSQL. That deployment will start with a
fresh, seeded database rather than importing development or demo records.

The user wants to focus on booking functionality now without spending M1 on cloud
infrastructure. A Google Cloud VM running the application and PostgreSQL is the
agreed demo arrangement for M2.

## Decision
Use PostgreSQL from the beginning of persisted booking implementation:
- **M1:** local application and local PostgreSQL only.
- **M2:** add a Google Cloud VM hosting the application and PostgreSQL for demos.
- **Final deployment direction:** Cloud Run with managed PostgreSQL, initialized
  with seed records. Its delivery milestone is not assigned by this record.

Use the same database engine and maintain schema migrations and repeatable seeds
across these environments. The existing SQLite scaffold must be replaced during
implementation; this decision does not claim that conversion is already complete.

## Business Rationale
Using the intended database engine now avoids a known SQLite-to-PostgreSQL
conversion later, including reworking and reverifying booking transactions and
constraints. Local-only delivery keeps M1 focused on a real persisted booking
without cloud setup. The later VM demo arrangement avoids requiring a separately
managed database during development.

## Alternatives Considered
- SQLite now and PostgreSQL later: inexpensive initially, but adds an engine
  conversion even though the final database choice is already known.
- Cloud hosting during M1: enables shared demonstrations sooner, but introduces
  deployment work the user explicitly prefers to undertake in M2.

## Consequences
- M1 acceptance uses local PostgreSQL; it does not require a hosted demo.
- Database integration and concurrency tests must exercise PostgreSQL.
- M2 includes VM deployment, secure access, persistent storage, and backup/recovery
  setup; PostgreSQL on the VM is operated by us, not a managed database service.
- Moving to Cloud Run still requires deployment configuration and verification,
  but not a database-engine conversion or transfer of existing demo records.
- Exact VM sizing, local database tooling, cloud costs, and final managed database
  configuration remain implementation-planning decisions.
