# Booking HTTP configuration

`readBookingConfiguration` in `src/server/booking-configuration.ts` validates trusted server configuration. It does not expose an HTTP endpoint. Booking intent cookies, bootstrap, submission and confirmation retrieval require their own transport integration; configuration alone does not enable booking or establish browser recovery.

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
