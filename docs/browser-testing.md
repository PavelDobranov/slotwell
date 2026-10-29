# Database-backed browser testing

Use a production build (`npm run build`), not a development server. Prototype and mocked-API tests use the ordinary Playwright environment; they are not database-backed acceptance evidence.

## Private-schema connection contract

A test owner creates and migrates a fresh private schema through `withTestDatabase`. Its two held connections do **not** configure a separate Next.js process. A browser server must explicitly attach its own pool with these server-only runtime variables:

- `SLOTWELL_BROWSER_TEST=private-schema-v1`
- `DATABASE_URL`: the existing allowlisted local `slotwell_test` role/database URL, never the developer/application URL
- `SLOTWELL_BROWSER_SCHEMA`: JSON containing exactly `name`, `oid`, `owner`, `nonce`, copied from that live owner's schema identity

Do not put these values in `NEXT_PUBLIC_*`, command arguments, checked-in environment files, browser state or reports. Pass them directly in the child process environment. Normal application startup remains app-only; missing, unknown or partial test selection fails closed without developer-data fallback. Importing the application does not connect or load test configuration eagerly.

Every new connection awaits verification of the database name, current role, database owner/marker and retained schema name/OID/owner/nonce. Only then may it be checked out. Its search path contains only the private schema (`pg_catalog` is implicit), never `public`. Identity queries use catalog-qualified functions and have server/driver timeouts; hook errors are redacted. Driver errors remain internal and must not be logged or forwarded to artifacts.

This is isolation for **trusted repository SQL and cooperating local processes**, not protection against hostile SQL or another process using the same test role. That role still owns sibling schemas. New-connection validation is not per-checkout verification; application code must not change session state or replace schema objects. No additional roles/grants or destructive application endpoints are authorized.

## Owner and process lifetime

The owner must remain alive for the entire server/browser lifetime. A worker gets its own fresh schema, server and loopback origin; replacement workers must not adopt old schemas. Stop the child and await actual process termination **before** returning from the owner callback and allowing guarded schema cleanup. Handle partial startup, readiness timeout and test failure as well as success. Do not reuse an existing server or drop a schema beneath a possibly live process.

Only the creating owner may attempt cleanup, using the existing retained identity guards. Do not reset shared/developer databases, scan/drop abandoned schemas or silently substitute demo fixtures on setup failure. Hard owner death can leave a private schema; it does not authorize a later run to adopt or delete it automatically.

## Sensitive browser artifacts

Use fictional contacts only. Confirmation fragments and retained operation credentials are still sensitive, even for fictional bookings. Never record them in traces, screenshots, videos, HTML/DOM error context, copied prompts, request dumps, attachments or console output. Do not compare or print whole credential-bearing URLs/receipts in assertion diagnostics. Disable automatic capture **before** visiting credential-bearing pages; deleting a trace afterward is not prevention. Persisted test output should contain only safe status/assertion summaries. Do not publish raw artifacts from these journeys.

Existing prototype capture settings do not make them suitable for persisted journeys. A database-backed fixture must enforce separate capture settings and verify its own child's database-backed readiness. Connection-attachment tests alone do not establish that lifecycle or full browser acceptance.
