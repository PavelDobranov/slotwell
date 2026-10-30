# Slotwell

A Bulgarian salon-booking application built with Next.js, Hono and PostgreSQL.
`/book` persists staff-first bookings locally; `/` is the separate in-memory prototype.

## Run locally

Requires Node.js 22.13+, npm and Docker/Compose. Follow the
[PostgreSQL setup](docs/postgresql.md) first, including credentials, bootstrap,
migrations and seeds.

```sh
npm ci --ignore-scripts
npm run dev
```

Open [localhost:3000/book](http://localhost:3000/book).

## Production-mode local run

```sh
npm run build
npm start
```
