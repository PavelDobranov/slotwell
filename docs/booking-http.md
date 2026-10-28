# Booking HTTP configuration

`readBookingConfiguration` in `src/server/booking-configuration.ts` validates trusted server configuration. `src/server/booking-routes.ts` exposes the bounded booking POST below through the thin Next adapter. Browser recovery/lifecycle/clear integration and confirmation retrieval remain separate; exposing POST does not establish wizard integration or durable browser recovery.

## Booking POST

`POST /api/bookings` requires `Content-Type: application/json` (optionally `charset=utf-8`), no content encoding other than identity, no query parameters, and at most **32,768 actual UTF-8 body bytes**, regardless of Content-Length. The request Origin must exactly match the configured origin. If Sec-Fetch-Site is supplied, it must be `same-origin`; missing/null/foreign Origin is rejected. No cookies, CORS grant or credentials in URLs are used.

The exact JSON shape is `{ operationId, credential, booking }`. The caller must already retain its lowercase UUID locator and independent 64-lowercase-hex credential before networking; see [browser intent storage](booking-browser-storage.md). The route registers that pair idempotently, then delegates to existing durable operations. It never mints a replacement pair or resets an existing deadline.

`booking` contains exactly:

- `staffId`: nonblank string, at most 64 characters.
- `serviceIds`: 1–20 distinct service identifiers, each at most 64 characters.
- `startsAt`: the existing strict minute-precision ISO timestamp with explicit offset.
- `reviewedServices`: one ordered consent snapshot per selected service, containing exactly `id`, `name`, `priceCents`, `currency`, `durationMinutes`, `cleanupMinutes`. Existing canonical limits apply: ID 64 characters, name 1,000 characters, currency 3 characters, nullable nonnegative safe-integer price, positive safe-integer duration, nonnegative safe-integer cleanup. These values are **not authoritative**: the booking transaction compares them with current catalog values and computes totals/durations itself.
- `contact`: exactly required `name`, `phone`, `email` and optional `note`, `phoneCountry`. Existing limits are 100/32/254/1,000 characters respectively; required strings are trimmed/nonblank. Optional country is at most two characters; actual contact validation and international normalization use the existing server validator and business default. Contact/profile/internal-ID additions and client totals are rejected, not echoed.

Boundary-invalid requests are rejected before registration. A structurally valid request later rejected by booking rules can leave its registered intent pending; reuse that pair rather than silently allocating a replacement. The registration and submit transactions deliberately retain their existing lifecycle semantics.

Both first success and identical retry return **200**, exactly `{ appointmentId, confirmationExpiresAt, viewToken }`. The view token is the intentionally authorized capability in this private JSON response; do not log it, attach it to telemetry or put it in an API URL/header. The response includes no contacts, notes, client profile or other internal fields. Confirmation URL/page mechanics are separate.

Errors contain only `{ error: { code } }`, except unknown outcomes also include `outcome: "unknown"` inside `error`:

| Status | Codes |
| --- | --- |
| 400 | `invalid_booking`, `invalid_contact` |
| 403 | `origin_forbidden` |
| 409 | `review_required`, `selection_unavailable`, `availability_conflict`, `operation_unavailable`, `payload_conflict` |
| 413 | `request_too_large` |
| 415 | `unsupported_media_type` |
| 503 | `booking_busy`, `recovery_unavailable` — always `outcome: "unknown"` |

Unexpected/configuration/database failures map to generic `recovery_unavailable`; neither route nor adapter logs raw exceptions or returns nested causes, stacks or submitted fields. A **503 is not evidence nothing committed**. Retain and retry the same pair; never automatically mint a replacement. Same-pair retries authenticate, preserve lifecycle state and replay the same receipt; changed agreements fail `payload_conflict`. Client-profile matching never grants access. Conflicts/review errors require the separately integrated UI to preserve contacts and valid selections, clear invalid time or obtain renewed consent as appropriate.

Every response from this endpoint, including failures, has `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`. Request bodies, credentials and receipts must remain outside logging/artifacts.

### Endpoint verification

`npx tsx --test src/server/booking-routes.db-test.ts` exercises real PostgreSQL success/replay, invalid/stale/deactivated selections, conflicts, unknown committed outcomes and generic errors. Its Hono CLI test runs `node node_modules/@hono/cli/dist/cli.js batch - <owned-temporary-wrapper> --compact` against the **actual app**, with a harness-owned private schema, synthetic credentials and a fixed clock. POST and replay must return the identical receipt and only one appointment. Only the summary is asserted; captured secrets/receipt bodies are never printed. The wrapper and schema are cleaned up by their respective owners, without a dev server or application-data reset.

The installed Hono CLI bundles CommonJS pg into a data URL. For standalone app inspection/batch commands, supply Node's native require through this non-secret preload (the focused test supplies it automatically):

```sh
NODE_OPTIONS="--import=data:text/javascript,import{createRequire}from'node:module';globalThis.require=createRequire(process.cwd()+'/package.json')" npx hono routes src/server/app.ts
```

This is a CLI compatibility measure, not new application configuration or a dependency change. Ordinary `app.request` tests and the Next adapter need no preload. Browser lifecycle/recovery/clearing and wizard acceptance remain #74/#77, not endpoint prerequisites.

## Local setup

Add these variables to the ignored root `.env.local`, retaining its mode `0600`. Never use `NEXT_PUBLIC_` names or commit real values. Next loads server environment variables; this module does not load dotenv or read `process.env` on import. Call it with the trusted environment lazily at the booking boundary, not during build or from request data. Standalone tooling must explicitly provide the environment.

- `SLOTWELL_BOOKING_ORIGIN`: the exact browser origin, such as `http://localhost:3000`. HTTPS is accepted; HTTP requires exactly `localhost`, `127.0.0.1` or `[::1]`. Scheme, host and port must match the canonical URL origin exactly: no trailing slash, credentials, path, query, fragment, whitespace, uppercase normalization or explicit default port. Never derive it from Host or forwarded headers. `secureCookies` is true for HTTPS and false only for an explicitly configured loopback HTTP origin. This local HTTP exception is not production deployment approval.
- `SLOTWELL_BOOKING_KEYS`: one JSON value with exactly `fingerprint` and `replay`. Each ring contains exactly `currentId` and `keys`. Each `keys` object has 1–16 own members, with ASCII IDs matching `[A-Za-z0-9_-]{1,64}` and values of exactly 64 lowercase hexadecimal characters (32 bytes). The current ID must exist in its ring. The complete JSON is limited to 16 KiB UTF-8. Duplicate object members follow `JSON.parse` last-member-wins semantics; only this parser consumes the configuration.

Shape only — these placeholders are intentionally invalid, not usable secrets:

```json
{
  "fingerprint": {
    "currentId": "h1",
    "keys": { "h1": "<independent random 32-byte lowercase hex HMAC key>" }
  },
  "replay": {
    "currentId": "e1",
    "keys": { "e1": "<different random 32-byte lowercase hex AES key>" }
  }
}
```

Generate each key independently with a cryptographic random source, and store it durably outside version control before starting booking integration. There are no defaults, generated-on-startup keys or fallback to another environment variable. Do not print configuration, key-bearing command arguments or parsed keys into logs, shell history, test artifacts or issue comments.

## Custody and rotation

Keep fingerprint and replay key bytes independent across **all** retained IDs, not just current IDs. Retain old IDs with unchanged key bytes through every live fingerprint/replay obligation; changing current IDs only affects new work. Back up keys with access restrictions matching the database, and restore the matching keys with database recovery. Key loss or corruption can prevent confirmation recovery; it never makes another booking safe. See [durable booking operations](booking-retries.md) for exact replay and expiry rules.

Validation returns fresh owned buffers and uses prototype-safe key maps. Every configuration failure throws only `booking_configuration_unavailable`, without raw values or a nested cause. A transport caller must translate this into its reviewed generic private response, never log the environment or parser/crypto errors. Configuration failure must not mint replacement intents or bypass durable operations.

To roll back configuration integration, stop invoking it. Do not delete live keys, retire old IDs prematurely, reset operation history or bypass the retry protocol.
