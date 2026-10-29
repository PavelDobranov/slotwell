# Database-backed browser testing

Use a production build (`npm run build`), not a development server. Prototype and mocked-API tests use the ordinary Playwright environment; they are not database-backed acceptance evidence.

## Run the persisted browser suites

From the repository root, with the existing local PostgreSQL test credentials configured:

```sh
npm run build
SLOTWELL_BROWSER_TEST=private-schema-v1 npm run test:e2e
```

This explicit mode runs `persisted-real*.spec.ts`, with two Chromium workers by default. Each worker owns a separate schema, server port/origin and ephemeral key set; replacement workers start fresh. No global server is reused. Setup errors fail visibly rather than skipping tests or selecting demo data.

- `persisted-real.spec.ts`: existing actual-HTTP smoke, confirmation reload, occupied conflict, expired access and artifact-policy checks.
- `persisted-real-journeys.spec.ts`: staff-first `/book` UI submission/reload, duplicate click with database counts, contact validation/back/edit preservation, real competing-slot rejection, generic transport failure with identical retry, and committed-but-lost-response recovery after reload and tab closure. Only transport faults are intercepted; catalog, availability, lifecycle, successful submission and confirmation use the owned production server and PostgreSQL. Aggregate counts and same-pair booleans avoid secret-bearing diagnostics.
- `persisted-real-accessibility.spec.ts`: actual Tab/Enter/Space/arrow-key walkthroughs at 390px and 1280px with a device zone different from the business zone. Checks named controls, focus transfer, validation descriptions, live status/busy states, horizontal overflow and console/page errors. This is automated keyboard/layout evidence, not a human visual review, screen-reader audit or WCAG certification.

To focus a slice, append its filename to the command above. The seed/scenario contract supplies fictional Sofia business hours; expected display values are formatted independently in that business zone, never the browser/device zone.

Without that environment selection, `npm run test:e2e` retains the existing prototype/mocked-API project and server environment and excludes all real-data suites. Do not run a build concurrently with browser tests using its output. The lifecycle helper also accepts a finite injected `anchor` for rolling setup; runtime HTTP clocks are never overridden. Its optional `onOwned` observer exposes only its own nonsecret schema name for failure-cleanup assertions, not deletion authority.

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

`scripts/e2e-db.ts` exposes `withPersistedBrowserServer(callback)` for this lifetime. Invoke it only with `SLOTWELL_BROWSER_TEST=private-schema-v1`; the existing harness loads local test credentials on invocation. Build first, including before the production-lifecycle checks in `npm run test:db`. The helper selects an OS-assigned loopback port, launches Next directly, passes ephemeral independent booking keys, and verifies database-backed readiness against a unique fictional business-name marker. It never captures child output. The callback receives rolling scenario helpers for a new booking, occupying it through the public booking use case, and historical expired confirmation access. Each new scenario must select availability afresh; two prepared submissions intentionally compete for the same slot.

The optional harness `canCleanup` callback can only reduce deletion authority: anything other than exact `true`, including an exception, refuses DROP and reports cleanup failure while closing the owner's held resources. The server helper uses this veto when TERM/KILL have not produced confirmed child closure.

Only the creating owner may attempt cleanup, using the existing retained identity guards. Do not reset shared/developer databases, scan/drop abandoned schemas or silently substitute demo fixtures on setup failure. Hard owner death can leave a private schema; it does not authorize a later run to adopt or delete it automatically.

## Sensitive browser artifacts

Use fictional contacts only. Confirmation fragments and retained operation credentials are still sensitive, even for fictional bookings. Never record them in traces, screenshots, videos, HTML/DOM error context, copied prompts, request dumps, attachments or console output. Do not compare or print whole credential-bearing URLs/receipts in assertion diagnostics. Disable automatic capture **before** visiting credential-bearing pages; deleting a trace afterward is not prevention. Persisted test output should contain only safe status/assertion summaries. Do not publish raw artifacts from these journeys.

The persisted configuration turns off traces/screenshots/videos, blocks service workers, uses only the list reporter, and sets the installed Playwright `PLAYWRIGHT_NO_COPY_PROMPT=1` switch to prevent automatic DOM snapshots. Its automatic fixture refuses unsafe capture/report overrides, reused or remote contexts, preloaded storage and recording context options before private navigation. Debug modes are refused. Do not bypass these guards, call explicit screenshot/trace/attachment APIs, or add network/body/console dumps.

Use the fixture's `submit`, `openConfirmation` and `reloadConfirmation` helpers so unexpected request/navigation failures expose fixed errors without private arguments. Assert safe booleans/status codes rather than whole receipts, browser URLs, storage values or request bodies. Standard Playwright can still generate `error-context.md` with sanitized errors and static test source; this is not a retained private DOM snapshot. Review any new assertion or helper for credential-bearing failure diagnostics before expanding the suite.

Output is confined to `coverage/playwright/persisted-results`; do not upload it automatically. Playwright clears this directory for a new run. Remove that run's local output when no longer needed; never broaden cleanup to developer data, another run's directory or abandoned schemas. Unexpectedly credential-bearing artifacts must not be shared: stop capture and treat the link/credential as disclosed. Browser profiles are disposable; confirmation tokens are never added to browser storage by the fixture.

Existing prototype capture settings do not make them suitable for persisted journeys. Preserve and run their meaningful assertions separately; neither mocked API checks nor prototype journeys count as database-backed acceptance. An occupied default server port is a setup limitation, not a passing regression run: do not reuse or stop an unrelated server. A temporary config may preserve test sources/assertions while selecting a free owned port; disclose origin-specific assertions and any unrun or pre-existing failures in the GitHub delivery evidence. Connection-attachment checks and browser suites alone do not establish aggregate M1 acceptance.
