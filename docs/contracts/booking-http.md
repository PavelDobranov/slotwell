# Booking HTTP and server configuration

Owns transport/security and operational configuration. [Retry semantics](booking-retries.md) own lifecycle and agreement identity; [browser storage](booking-browser-storage.md) owns durable allocation. Delivery scope/status belongs to GitHub tasks, not this contract. POST availability alone does not establish wizard or browser-recovery acceptance (#74/#77).

## Transport contract

`POST /api/bookings` accepts `{ operationId, credential, booking }`. The pair must already be durably retained before networking. Registration is idempotent: never mint a replacement pair or reset its deadline. Invalid boundary input is rejected before registration; a later business rejection can leave an intent pending.

Require JSON (optional UTF-8 charset), no query parameters, identity/no content encoding, and at most **32,768 actual body bytes** regardless of Content-Length. Origin must exactly match trusted configuration; supplied Sec-Fetch-Site must be `same-origin`. Reject absent/null/foreign Origin. No cookies, CORS grant, or credentials in URLs.

Reviewed service values represent consent, not authoritative prices/durations/eligibility. The transaction rechecks current values and computes its own totals. Reject contact-profile/internal-ID additions; do not echo them. Exact accepted fields, primitive bounds, response shapes, status/error mappings, and rejection order are defined by the route validation and its regression tests; preserve them during refactoring rather than maintaining a second schema here.

First success and identical retry return the same private receipt. Never expose contacts, notes, client profiles, raw errors, causes, stacks, or submitted fields. Configuration/driver failures use the generic unavailable response. `booking_busy` and `recovery_unavailable` mean **unknown outcome**, not evidence nothing committed: retain the same pair. Changed agreements fail `payload_conflict`. UI conflict/review handling preserves contacts and valid selections and requires refreshed availability/renewed consent where appropriate.

All endpoint responses, including errors, require `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`. The authorized receipt token belongs only in the private response/reviewed confirmation-link flow, not API URLs or headers. Keep request bodies, credentials, receipts, and raw exceptions out of logs, telemetry, and artifacts.

## Trusted configuration

Use ignored root `.env.local`, mode `0600`; never `NEXT_PUBLIC_` variables or committed secrets. Read configuration lazily at invocation, not import/build time or from request data. Next loads server variables; standalone tooling must provide its environment explicitly.

- `SLOTWELL_BOOKING_ORIGIN`: exact canonical browser origin. HTTPS is allowed; HTTP only for `localhost`, `127.0.0.1`, or `[::1]`. No path, trailing slash, credentials, query, fragment, whitespace, or normalization-dependent spelling. Never derive it from Host/forwarded headers. Secure-cookie policy follows HTTPS; loopback HTTP is not deployment approval.
- `SLOTWELL_BOOKING_KEYS`: JSON with independent fingerprint/HMAC and replay/AES key rings. Each has a current ID present among retained IDs; each key is an independent random 32-byte lowercase-hex value. No startup-generated/default/fallback keys. Parser bounds and exact ID syntax belong to configuration validation/tests.

Shape only; placeholders are deliberately invalid:

```json
{
  "fingerprint": { "currentId": "h1", "keys": { "h1": "<random 32-byte lowercase hex>" } },
  "replay": { "currentId": "e1", "keys": { "e1": "<different random 32-byte lowercase hex>" } }
}
```

Generate keys independently with cryptographic entropy and store them durably before use. Independence applies across **all retained IDs**, not just current IDs. Retain unchanged old keys for every live fingerprint/replay obligation; rotating current IDs affects new work only. Back up/restore matching keys with the database under equivalent access restrictions. Key loss/corruption never makes a replacement booking safe.

Never print keys/configuration in logs, command arguments, shell history, test artifacts, or issue comments. Failures expose only `booking_configuration_unavailable`, translated by transport into its generic private response. Rollback means stop invoking integration—not deleting live keys/history or bypassing retry safeguards.

## Verification exception

Use the existing booking-route PostgreSQL tests with synthetic credentials and private harness-owned schemas; never shared application data, printed receipts, or retained secret-bearing artifacts. Endpoint verification is not end-to-end wizard acceptance.

The installed Hono CLI bundles CommonJS pg into a data URL. After `npx hono --help`, standalone inspection needs this non-secret preload (the focused CLI test supplies it):

```sh
NODE_OPTIONS="--import=data:text/javascript,import{createRequire}from'node:module';globalThis.require=createRequire(process.cwd()+'/package.json')" npx hono routes src/server/app.ts
```

This is a tooling workaround, not application configuration or a new dependency; Next and ordinary `app.request` tests need no preload.
