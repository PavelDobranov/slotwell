# Architecture conventions

## Application boundaries

The server uses capability modules with a separate HTTP adapter. Catalog, availability, and booking have public `index.ts` entry points; legacy flat compatibility files have been removed. Runtime capability dependencies are booking → availability/catalog and availability → catalog, with no reverse edges.

Boundary enforcement is currently manual: review public exports, cross-capability imports, application/HTTP separation, shared dependencies, and cycles when changing these modules. Automated architecture checks were explicitly deferred during #106 acceptance work; existing tests do not enforce those import boundaries.

- Business modules expose application use cases, their input/output types, and application errors through explicit named exports in `index.ts`. Export minimal construction contracts only when needed for dependency wiring. No utility/repository/route exports, database-row-shaped business contracts, or `export *`.
- HTTP routes consume those public interfaces. They own request parsing, transport validation, origin/media-type policies, headers, and status mapping. Application logic must not depend on Hono, Request/Response, or HTTP status codes.
- Use cases enforce business invariants even when called without HTTP. Dependencies such as a database, clock, or configuration remain explicit and injectable; setup is distinct from business input.
- Other capabilities import only public entry points. Internal files import their own implementation directly, not their own barrel. Colocated implementation tests may access internals. No circular capability dependencies.
- Prefer ordinary functions and a few responsibility-named files. No mandatory service/repository stack, generic DI framework, empty folders, or module READMEs. Types/names explain the interface; comments explain non-obvious constraints.

## Placement and imports

- Next.js routes stay under `src/app/`; do not add a competing root `app/` or separate `src/client/` namespace. Keep its API adapter thin; `src/server/app.ts` composes Hono.
- Put transport adapters under `src/server/http/` and business capabilities directly under `src/server/` (currently catalog, availability, booking). Create nested folders only when actual code benefits.
- `src/db/` owns connection lifecycle, schema, and tooling. Capability queries and persistence coordination belong with the capability, not in global repositories.
- Genuinely shared pure rules belong in narrowly named `src/shared/` modules, not capability public APIs or an unowned `utils/` folder. `src/shared/` is a cross-layer sibling of `src/app/`, `src/server/`, and `src/db/`: any layer may import it, and it must not import server internals. (Not to be confused with `src/app/_lib/`, which is route-shared frontend code.) Keep guest-contact shared; give existing scheduling-time and service-selection rules shared ownership during migration rather than duplicating them.
- Frontend business features belong in `src/app/_features/`, even when used by one route. Pages compose feature providers and views while preserving server/client boundaries; keep pages server components where possible, with client feature entrypoints as needed. A feature owns its UI, server-data access, client state, business logic, and tests. Use responsibility-named subfolders only when useful, not parallel feature-wide `components/` and `lib/` silos or empty folders.
- Shared frontend UI primitives belong in `src/app/_components/` (no nested `ui/`); genuinely cross-feature frontend helpers belong in narrowly named `src/app/_lib/` modules. Keep shadcn aliases aligned. Keep demo and real booking independent; cross-layer rules retain `src/shared/` ownership.
- Use `@/…` for project imports, including same-folder imports; separate them from package/native imports with a blank line.
- Group frontend tests in their owning folder's `tests/`, preserving `.test.ts` versus `.browser-test.ts` discovery semantics; leave `e2e/` organization unchanged. Backend tests remain colocated. `.test.ts` must remain database-independent; `.db-test.ts` uses the existing isolated PostgreSQL harness.

## Frontend state and composition

- Each shared client-state boundary uses one `context.tsx` owning state/actions, initial state, pure reducer, exported feature-specific context/provider, and guarded consumer hook. Export the reducer for direct transition tests; UI consumers use state/dispatch, not the reducer. Complex pure rules may remain separate modules. Reducers perform no I/O, clock sampling, or fixture bootstrap; client entrypoints/providers own effects.
- Scope providers to the narrowest consuming subtree; do not introduce a global booking provider or a provider merely for symmetry. Context-connected components orchestrate; prop-driven views do not consume feature context. Keep paging, field errors, and simple disclosure state local.
- React Query owns server query data; expose needed query results without duplicating its cache in reducer state. The existing submission controller/binding remains authoritative for single-flight, immutable agreement ownership, uncertainty, and retention permissions. Context connects the UI; it is not a second controller.

## Invariants during refactoring

Modules encapsulate code, not exclusive table ownership. Preserve booking's cross-table lock/query order, isolation level, transaction handle, and database constraints. Availability revalidation inside booking must use the existing transaction, not another pool connection or independent transaction.

Importing the app must not open a database or require environment configuration eagerly. Application-only DB access stays server-only; scripts/tests use `src/db/open.ts`, not `src/db/index.ts`.

Separate mechanical moves from semantic extraction. Track and remove temporary compatibility shims; do not let a legacy flat file shadow a module's public entry point. Preserve observable API, validation, clock/time-zone, privacy, and replay behavior; the refactor does not authorize schema, dependency, UI, or product-policy changes. Read the relevant [contracts](../contracts/booking-http.md) before changing those behaviors.
