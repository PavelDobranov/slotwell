# Slotwell

Next.js frontend and Hono API in one project, served by one process.

## Structure

```text
src/
  app/                       Next.js frontend
    _components/             Frontend UI components (non-routing)
    _lib/                    Frontend utilities (non-routing)
    api/[[...route]]/route.ts Thin adapter exposing Hono at /api/*
    layout.tsx
    page.tsx
    globals.css
  server/app.ts              Hono app and API routes
```

Keep frontend pages and support code in `src/app/`, and backend logic in `src/server/`.
The `_components/` and `_lib/` folders are private Next.js folders, excluded from routing.
Use `src/app/_components/` and `src/app/_lib/` for shared frontend code.
Colocate route-specific components and utilities in that route's own `_components/` and `_lib/` folders as needed.
Keep shared components directly in `_components/`, without an extra `ui/` folder.
Keep all Next.js routes under `src/app/`; do not create a root `app/` directory.

## Development

```sh
npm install
npm run dev
```

- Frontend: http://localhost:3000
- API health: http://localhost:3000/api/health → `{"status":"ok"}`

## Checks and production

```sh
npm run lint
npm run build
npm start
```
