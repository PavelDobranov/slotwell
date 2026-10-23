# File structure vision

Keep the structure minimal today and grow it through colocation. This is a starting direction, not a fixed architecture; refine these guidelines as the project grows.

```text
src/
  app/                       Next.js frontend and routing
    _components/             Shared frontend components (no nested ui/ folder)
    _lib/                    Shared frontend utilities
    dashboard/               Example feature route; create only when needed
      _components/           Dashboard-specific components
      page.tsx
    settings/                Example feature route; create only when needed
      _components/           Settings-specific components
      page.tsx
    api/
      [[...route]]/
        route.ts             Thin Next.js adapter exposing the Hono API
    layout.tsx
    page.tsx
    globals.css
  db/                        Server-only database layer
    schema.ts                Database schema
    open.ts                  Database factory for Node scripts and tests
    index.ts                 Application-only entry point (server-only)
  server/
    app.ts                   Hono app and API routes
```

- Keep frontend code under `src/app/`, API/backend logic under `src/server/`, and the database layer under sibling `src/db/`. Database access is server-only; scripts and tests use `src/db/open.ts`, not the application-only `src/db/index.ts`. Do not introduce a separate `src/client/` namespace.
- Keep all Next.js routes under `src/app/`; a root `app/` directory would cause Next.js to ignore `src/app/`.
- Use app-level `_components/` and `_lib/` for code shared across frontend routes. Colocate feature-specific code in that route's own `_components/` or `_lib/` folder.
- Underscore-prefixed folders are private Next.js folders, excluded from routing.
- Keep API route handlers thin; Hono owns backend routes and business logic.
- Create folders and abstractions only when real code needs them. The example routes above are illustrative, not a scaffold to generate.
- Use `@/…` aliases for all project imports, including within a folder: `@/*` → `src/*` (for example, `@/app/_components/button`, `@/server/app`, and `@/db/open`). Separate project imports from package and native-module imports with a blank line. Keep shadcn aliases in `components.json` aligned with the structure.
- Add backend subfolders or genuinely shared frontend/backend code only when needed; do not prebuild layers for hypothetical growth.
