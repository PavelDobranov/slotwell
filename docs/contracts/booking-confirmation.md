# Private confirmation access

Owns the appointment-specific view credential, retrieval and link protocol. [Booking HTTP](booking-http.md) owns trusted origin configuration; [retry semantics](booking-retries.md) own issuance/encrypted receipt recovery, not confirmation authorization. Delivery status and approval evidence belong to #72/#112; #73 owns page implementation and #74 submission integration.

## Credential and link

Use the existing independent random 32-byte view token, encoded as 64 lowercase hexadecimal characters. Store only SHA-256 of the decoded token bytes in appointment access; encrypted operation replay remains separate. The public appointment UUID is a locator, not authorization. Every read requires the matching appointment/token pair. No contact-field lookup, history or mutation permission follows.

The approved page entry is `/confirmation#appointmentId=<lowercase-uuid>&viewToken=<64-lowercase-hex>`. Browser JavaScript reads the fragment and submits it only in the JSON request body below. No cookie, exchange session, credential header, API URL token, redirect token, or browser-storage copy. Retain the fragment for reload/bookmark access; anyone holding the full URL can view its permitted contents until expiry.

**Accepted tradeoff:** fragments do not reach the HTTP request target, but remain exposed to browser history/bookmarks, extensions and same-origin JavaScript. This is not protection against XSS or a compromised browser. Never log links/tokens/request bodies/results/SQL binds or include them in telemetry, console output or retained artifacts. No confirmation token belongs in the retained-operation IndexedDB store.

## Read-only application contract

`readConfirmation(db, { appointmentId, viewToken }, clock)` validates primitive credential syntax before I/O, copies/hashes credentials before awaiting, and reads immutable booking-time appointment/service snapshots only. It does not require operation credentials, replay ciphertext or key rings; it does not register, submit, clear, prune, renew or modify anything.

Sample finite, representable integer server time after the query/waits. Require `now < confirmationExpiresAt`, with expiry exactly stored service end + **168 elapsed hours**. Equality is expired. Expiry never deletes or changes stored history.

The exact result/200 JSON allowlist is:

```typescript
{
  status: "confirmed";
  startsAt: string; // UTC ISO instant
  serviceEndsAt: string; // UTC ISO instant, not occupied end
  bookingTimeZone: string; // booking-time IANA zone
  staffName: string; // booking-time snapshot
  businessAddress: string; // booking-time snapshot
  confirmationExpiresAt: string; // UTC ISO instant
  services: {
    name: string;
    priceCents: number | null;
    currency: string;
    durationMinutes: number;
  }[]; // booking order
}
```

No internal identifiers, contact name/phone/email, notes, cleanup/occupancy, credentials or operation metadata. No total field: null prices stay unknown, not zero. No live catalog/staff/address display joins. No change actions or email promises.

Integrity checks cover confirmed status, finite ordered instants and exact expiry, usable named time zone, nonempty contiguous zero-based service positions, common currency, and summed service duration equal to the service interval. SQL constraints enforce individual stored field bounds; arbitrary SQL is not made append-only. Authenticated incomplete/inconsistent snapshots fail closed.

Missing/mismatched/pruned/expired access and malformed direct application credentials produce `confirmation_unavailable`. Driver/clock/integrity failures produce `confirmation_temporarily_unavailable`. Errors contain only these codes, without raw errors or causes.

## HTTP and page obligations

`POST /api/confirmations/read` accepts exactly `{ appointmentId, viewToken }`. The adapter independently validates primitive lowercase UUID/64-hex syntax; malformed transport is 400 `invalid_confirmation`, not an authorization distinction. No query parameters. Require JSON (optional UTF-8 charset), identity/no content encoding and at most **1,024 actual bytes**, regardless of Content-Length. Exact trusted Origin is required; supplied Sec-Fetch-Site must be `same-origin`. No CORS grant or cookie-based authorization. Read origin lazily; confirmation reads do not require replay keys.

Responses use `{ error: { code } }`: 400 `invalid_confirmation`, 403 `origin_forbidden`, 413 `request_too_large`, 415 `unsupported_media_type`, 404 `confirmation_unavailable` for unavailable access, 503 `confirmation_temporarily_unavailable` for redacted operational failures. Unsupported methods return 405 `method_not_allowed` with `Allow: POST`; HEAD has no body. Never distinguish invalid from expired access.

All endpoint responses, including errors/method rejections, require `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and `X-Robots-Tag: noindex, nofollow, noarchive`. Protect the deployed Next adapter as well as Hono. No body/token logging or raw driver errors.

The #73 page must enforce no-store/no-referrer/no-index, avoid third-party scripts/resources, keep secrets out of telemetry/artifacts/storage, and use safe outgoing links. Fragment access, reload, privacy headers and business-zone display require real-browser verification there; this contract does not claim page or M1 acceptance.
