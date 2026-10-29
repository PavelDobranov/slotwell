# Booking HTTP and server configuration

Owns transport/security and operational configuration. [Retry semantics](booking-retries.md) own lifecycle and agreement identity; [browser storage](booking-browser-storage.md) owns durable allocation. Delivery scope/status belongs to GitHub tasks, not this contract. POST availability alone does not establish wizard or browser-recovery acceptance (#74/#77).

## Catalog inputs for booking

`GET /api/catalog` exposes configured `business.defaultPhoneCountry` for contact parsing and each active service's `cleanupMinutes` and `currency` alongside its name, price and duration. These required read fields come from the corresponding business/service records; service currency is not inferred from business currency, and zero cleanup is preserved. They let the browser present the current agreement without fabricating consent values or hardcoding a phone country. Catalog reads are not a reservation or authority to submit stale values: booking still revalidates the reviewed service values and contact input on the server.

## Transport contract

`POST /api/bookings` accepts `{ operationId, credential, booking }`. The pair must already be durably retained before networking. Registration is idempotent: never mint a replacement pair or reset its deadline. Invalid boundary input is rejected before registration; a later business rejection can leave an intent pending.

Require JSON (optional UTF-8 charset), no query parameters, identity/no content encoding, and at most **32,768 actual body bytes** regardless of Content-Length. Origin must exactly match trusted configuration; supplied Sec-Fetch-Site must be `same-origin`. Reject absent/null/foreign Origin. No cookies, CORS grant, or credentials in URLs.

Reviewed service values represent consent, not authoritative prices/durations/eligibility. The transaction rechecks current values and computes its own totals. Reject contact-profile/internal-ID additions; do not echo them. Exact accepted fields, primitive bounds, response shapes, status/error mappings, and rejection order are defined by the route validation and its regression tests; preserve them during refactoring rather than maintaining a second schema here.

First success and identical retry return the same private receipt. Never expose contacts, notes, client profiles, raw errors, causes, stacks, or submitted fields. Configuration/driver failures use the generic unavailable response. `booking_busy` and `recovery_unavailable` mean **unknown outcome**, not evidence nothing committed: retain the same pair. Changed agreements fail `payload_conflict`. UI conflict/review handling preserves contacts and valid selections and requires refreshed availability/renewed consent where appropriate.

All endpoint responses, including errors, require `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`. The authorized receipt token belongs only in the private response/reviewed confirmation-link flow, not API URLs or headers. Keep request bodies, credentials, receipts, and raw exceptions out of logs, telemetry, and artifacts.

## Retained-intent lifecycle transport

`POST /api/booking-intents/resolve` and `POST /api/booking-intents/clear` accept exactly `{ operationId, credential }`, with the same primitive pair syntax as submission. They call the public booking lifecycle use cases, not private operations. Resolve idempotently registers the already-retained pair and returns either `{ state: "pending", submitBefore }` or `{ state: "committed", receipt }`. Clear returns only `{ state: "fenced" }` or `{ state: "committed" }`; it never registers pending work or decrypts a receipt. Pending is a snapshot, and committed classification is not permission to forget. Only an explicit clear with a received durable `fenced` acknowledgement may proceed to reviewed atomic local deletion; no response/error permits automatic replacement.

Both endpoints inherit submission's trusted origin/key configuration, required Origin, optional same-origin Sec-Fetch-Site, JSON/UTF-8, identity encoding, query rejection and private response headers. Pair-only bodies are limited to **1,024 actual bytes**, independent of Content-Length. Rejection order is method → configuration → origin → query/media → strict UTF-8 bounded body/shape → use case. Unsupported methods return private 405 with `Allow: POST` (HEAD has no body), including through explicit Next dispatch. No cookies or CORS grant.

Success is 200 with the exact application result. Malformed input returns 400 `invalid_booking`, oversized bodies 413 `request_too_large`, origin rejection 403 `origin_forbidden`, and media/encoding rejection 415 `unsupported_media_type`. Authenticated `operation_unavailable` returns 409. Configuration/driver/lock/other unavailable failures return redacted 503 `recovery_unavailable` with `outcome: "unknown"`. Neither 409 nor 503 authorizes discarding the pair, releasing capacity or starting a replacement. Credentials and recovered receipts remain sensitive; the same no-logging/no-artifact rules apply.

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
