<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Task context

Load only the relevant documents, not all of `docs/`:

| When | Read |
| --- | --- |
| Placement/import decisions or backend changes | [Architecture](docs/agents/architecture.md) |
| Publishing/updating plans, tasks, or issue relationships | [Issue workflow](docs/agents/issue-tracker.md) |
| Booking endpoints, trusted configuration, or key custody | [HTTP contract](docs/contracts/booking-http.md) |
| Idempotency, recovery, clearing, or retention | [Retry contract](docs/contracts/booking-retries.md) |
| Browser intent persistence or cross-tab capacity | [Browser storage contract](docs/contracts/booking-browser-storage.md) |
| Product scope or reasons behind a product decision | [Product brief](docs/product-brief.md); follow only the relevant ADR link |

GitHub specifications/plans own milestone scope, approvals, and progress. The brief describes the broader MVP, not current delivery. Contracts own non-obvious guarantees; source/tests own implementation details. If these disagree, surface the conflict rather than silently selecting one.

Keep context lean: one authoritative home per rule, conditional links here, no copied file inventories/test lists/progress summaries. Preserve decision rationale, security constraints, and compatibility obligations when shortening docs.

## Hono CLI

Run `npx hono --help` first, and use the CLI instead of a dev server.