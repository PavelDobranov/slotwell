# Durable booking operations

`src/server/booking-operation.ts` is a backend-only boundary. It is not an HTTP or cookie API. Do not expose submission until the transport has reviewed credential bootstrap/round-trip confirmation, same-origin protection, durable HttpOnly intent cookies and independent-tab recovery. Never put contacts in browser storage or log credentials, canonical payloads, fingerprints, SQL bind parameters or booking responses.

## Intent and configuration

`createBookingOperations(keys)` takes independent durable 32-byte HMAC and AES key rings, each with a current ID. Keys must come from trusted server configuration, never a request; there are no ephemeral defaults. The instance copies key buffers. Retain old IDs and their unchanged keys through all live replay obligations; losing keys must not authorize replacement bookings. No environment-variable loader or key generation-on-startup is provided.

`createIntent(db, clock)` creates an independent public UUID locator and random 32-byte hex credential. Only its SHA-256 hash is persisted. Pending submission expires exactly 24 elapsed hours after creation. Establish and confirm durable possession of the credential before attempting submission; a lost bootstrap response must not execute a booking.

Canonical agreement v1 uses ordered JSON fields: version, staff ID, ordered service IDs, UTC start instant, ordered reviewed-service snapshot values, trimmed required contact fields, verbatim note (omitted means empty), submitted phone country (omitted means null). Object property order and equivalent timestamp offsets are irrelevant; service order, phone formatting, email case and note whitespace remain meaningful. Canonicalization does not consult changing catalog or country defaults. It copies validated fields before asynchronous work. Never persist the plaintext canonical agreement.
