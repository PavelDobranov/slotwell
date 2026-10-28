# Durable booking operations

`src/server/booking-operation.ts` is a backend-only boundary. It is not an HTTP or cookie API. Do not expose submission until the transport has reviewed credential bootstrap/round-trip confirmation, same-origin protection, durable HttpOnly intent cookies and independent-tab recovery. Never put contacts in browser storage or log credentials, canonical payloads, fingerprints, SQL bind parameters or booking responses.

## Intent and configuration

`createBookingOperations(keys)` takes independent durable 32-byte HMAC and AES key rings, each with a current ID. Keys must come from trusted server configuration, never a request; there are no ephemeral defaults. The instance copies key buffers. Retain old IDs and their unchanged keys through all live replay obligations; losing keys must not authorize replacement bookings. No environment-variable loader or key generation-on-startup is provided.

`createIntent(db, clock)` creates an independent public UUID locator and random 32-byte hex credential. Only its SHA-256 hash is persisted. Pending submission expires exactly 24 elapsed hours after creation. Establish and confirm durable possession of the credential before attempting submission; a lost bootstrap response must not execute a booking.

## Submit and recover

`submit(db, credential, input, clock)` and `recover(db, credential, clock)` return only `{ appointmentId, confirmationExpiresAt, viewToken }`. The token is sensitive: transport must enforce private, no-store responses and the reviewed private-link mechanism. This module does not build confirmation URLs.

Submission keeps the operation lock through booking, keyed fingerprint comparison and authenticated token recovery. Identical committed submissions return the same receipt without consulting the current catalog or default phone country; changed submitted agreements fail with `payload_conflict`. A failed transaction leaves the existing pending intent reusable until its deadline. `recover` cannot execute a pending booking.

Replay is valid only before the appointment's original service-end + 168 elapsed-hour expiry, even when the submission deadline has passed. AES-256-GCM stores a 12-byte nonce, 32-byte token ciphertext and 16-byte authentication tag; authenticated data binds version, operation, appointment and expiry. Recovered tokens must match the stored access hash. Old key IDs remain readable after rotation. Missing keys or corrupt/inconsistent replay data fail closed.

`booking_busy` and `recovery_unavailable` are **unknown**, not evidence that nothing committed. Keep the same intent and resolve/retry it; never mint a replacement automatically. Error codes contain no query values or causes. Log neither function arguments/results nor database error objects. `operation_unavailable` covers wrong credentials, noncommitted recovery and expired/terminal operations. Booking validation/conflict codes remain those of `bookAppointment`.

## Retention

`pruneExpired(db, operationId, clock)` is a trusted maintenance function, not a guest reset endpoint or scheduled job. It locks and rereads the operation. Pending intents become tombstones at their submission deadline; committed operations become tombstones only at the exact original confirmation expiry, after checking the authoritative appointment expiry. Inconsistent metadata fails without deletion. Cleanup atomically deletes access material and clears the operation's appointment association, fingerprint, ciphertext and key IDs. Appointment/contact/service/occupancy history remains intact. Terminal rows retain locator/hash/state and original lifecycle timestamps indefinitely; only an independently authorized explicit local reset may remove them. Cleanup never creates new intents. Expired replay fails even when cleanup has not run.

To roll back runtime integration, stop invoking this module; do not delete tombstones, reset data, retire live keys or fall back to the raw booking transaction. The underlying schema is unchanged. Cookie/bootstrap/directory/abandon fencing and retrieval/page privacy controls require their own reviewed transport integration; this module alone does not establish reload/tab-closure recovery in a browser.

## Canonical agreement

Canonical agreement v1 uses ordered JSON fields: version, staff ID, ordered service IDs, UTC start instant, ordered reviewed-service snapshot values, trimmed required contact fields, verbatim note (omitted means empty), submitted phone country (omitted means null). Object property order and equivalent timestamp offsets are irrelevant; service order, phone formatting, email case and note whitespace remain meaningful. Canonicalization does not consult changing catalog or country defaults. It copies validated fields before asynchronous work. Never persist the plaintext canonical agreement.
