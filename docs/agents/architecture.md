# Architecture conventions

## Application boundaries

The agreed server target is capability modules with a separate HTTP adapter. The flat server files have not yet been migrated; follow the approved task's scope rather than assuming the target already exists.

- Business modules expose application use cases, their input/output types, and application errors through explicit named exports in `index.ts`. Export minimal construction contracts only when needed for dependency wiring. No utility/repository/route exports, database-row-shaped business contracts, or `export *`.
- HTTP routes consume those public interfaces. They own request parsing, transport validation, origin/media-type policies, headers, and status mapping. Application logic must not depend on Hono, Request/Response, or HTTP status codes.
- Use cases enforce business invariants even when called without HTTP. Dependencies such as a database, clock, or configuration remain explicit and injectable; setup is distinct from business input.
- Other capabilities import only public entry points. Internal files import their own implementation directly, not their own barrel. Colocated implementation tests may access internals. No circular capability dependencies.
- Prefer ordinary functions and a few responsibility-named files. No mandatory service/repository stack, generic DI framework, empty folders, or module READMEs. Types/names explain the interface; comments explain non-obvious constraints.

## Placement and imports

- Next.js routes stay under `src/app/`; do not add a competing root `app/` or separate `src/client/` namespace. Keep its API adapter thin; `src/server/app.ts` composes Hono.
- Put transport adapters under `src/server/http/` and business capabilities directly under `src/server/` (currently catalog, availability, booking). Create nested folders only when actual code benefits.
- `src/db/` owns connection lifecycle, schema, and tooling. Capability queries and persistence coordination belong with the capability, not in global repositories.
- Genuinely shared pure rules belong in narrowly named `src/lib/` modules, not capability public APIs or an unowned `utils/` folder. Shared libraries must not import server internals. Keep guest-contact shared; give existing scheduling-time and service-selection rules shared ownership during migration rather than duplicating them.
- Frontend code shared across routes belongs in `src/app/_components/` or `_lib/`; route-specific code stays in that route's private folders. No nested `ui/` under the shared components folder. Keep shadcn aliases aligned.
- Use `@/…` for project imports, including same-folder imports; separate them from package/native imports with a blank line.
- Colocate tests. `.test.ts` must remain database-independent; `.db-test.ts` uses the existing isolated PostgreSQL harness.

## Invariants during refactoring

Modules encapsulate code, not exclusive table ownership. Preserve booking's cross-table lock/query order, isolation level, transaction handle, and database constraints. Availability revalidation inside booking must use the existing transaction, not another pool connection or independent transaction.

Importing the app must not open a database or require environment configuration eagerly. Application-only DB access stays server-only; scripts/tests use `src/db/open.ts`, not `src/db/index.ts`.

Separate mechanical moves from semantic extraction. Track and remove temporary compatibility shims; do not let a legacy flat file shadow a module's public entry point. Preserve observable API, validation, clock/time-zone, privacy, and replay behavior; the refactor does not authorize schema, dependency, UI, or product-policy changes. Read the relevant [contracts](../contracts/booking-http.md) before changing those behaviors.
