# Booking retry and recovery semantics

Owns intent identity, lifecycle, replay, fencing, and retention. [Browser storage](booking-browser-storage.md) owns durable allocation/capacity; [HTTP configuration](booking-http.md) owns transport, key provisioning/rotation, and secret-safe verification. This is a backend contract, not evidence of browser integration or milestone completion.

Do not enable browser/wizard submission until durable allocation, authenticated registration/resolution, same-origin protection, and independent-tab recovery are integrated and verified. The separately scoped backend POST does not waive this browser-integration gate (#74).

## Identity and registration

An intent has a public lowercase UUID locator and independent 32-byte credential encoded as 64 lowercase hexadecimal characters. Accept copied primitive strings only. Persist only the credential's SHA-256 hash. Credentials must not derive from contact fields, locator, or time; the server cannot verify browser entropy.

A caller must retain its pair before networking. Backend-generated credentials are not a browser fallback: a lost creation response leaves no browser-held recovery credential. Pending submission expires exactly **24 elapsed hours** after creation, using trusted server time.

Registration atomically inserts if absent, then locks/authenticates. A matching retry leaves **every existing field unchanged**, including creation/deadline, committed material, and terminal state. A different credential for the locator, or reuse under another locator, fails `operation_unavailable` without overwrite. Registration returns no receipt/status and does not establish eligibility to submit. Retry lost acknowledgements with the same pair.

## Resolution and submission

The public `resolveBookingIntent` use case copies the retained pair, idempotently registers it, then invokes read-only resolution in a separate transaction. Registration can commit even if resolution fails; an intervening clear fails closed and an intervening submission is recovered. No outcome permits replacement. `clearBookingIntent` invokes only fencing, never registration or receipt recovery. Both use explicit database/key/clock dependencies; clear requires valid configured key rings but not the historical keys needed for receipt decryption. Neither exposes the private operation factory or trusted pruning.

Read-only resolution authenticates under the bounded operation-row lock without contacts/agreement or current-catalog access. It returns pending with the original deadline or recovers the committed receipt; it never registers, submits, or mutates lifecycle/access data. Sample trusted time after acquiring the lock, including terminal rows. Exact deadline/confirmation-expiry equality is expired.

Pending is **only a snapshot**: submission may occur after lock release. Missing rows cannot exclude delayed registration. No resolution result/error authorizes record removal, released capacity, or automatic replacement. Idempotently register an already-retained unregistered pair before resolving it.

Submission holds the operation lock through booking, fingerprint comparison, and authenticated receipt recovery. Identical committed submissions replay without consulting changed catalog/default-country values; changed agreements fail `payload_conflict`. A rolled-back transaction leaves pending reusable until its original deadline. Recovery cannot execute a pending booking.

The private receipt contains appointment ID, original confirmation expiry, and sensitive view token. Replay is valid only **before service end + 168 elapsed hours**, even after submission expiry and even if pruning has not run. Authenticated replay binds version, operation, appointment, and expiry; recovered tokens must match the stored access hash. Retained old key IDs remain readable after rotation. Missing keys, corrupt ciphertext, inconsistent authoritative expiry, or token-hash mismatch fail closed.

`booking_busy`/`recovery_unavailable` mean **unknown outcome**, not proof nothing committed. Retain and resolve/retry the same pair, never automatically replace it. Missing/wrong credentials, expired/terminal/noncommitted recovery, and incomplete/unsupported committed metadata use generic `operation_unavailable`; corrupt/inconsistent recovery material and driver/timeouts use redacted `recovery_unavailable`. Preserve existing booking validation/conflict outcomes. Errors contain no submitted values or nested causes.

## Explicit noncommitted clear

Fencing is only for an explicit user clear, never automatic expiry/eviction. It requires a top-level database transaction owner: a transaction/savepoint handle cannot provide a durable acknowledgement. Validate credentials and representable lifecycle timestamps before I/O; validate trusted time again after lock waits on every branch.

- Absent pair: insert an abandoned fence with credential hash and original structural lifecycle timestamps (creation + 24 hours is not submission permission).
- Pending: mark abandoned, preserving all other fields.
- Abandoned/tombstone: unchanged.
- Wrong credentials or reuse under another locator: `operation_unavailable`, no mutation.

Return `fenced` **only after the owning transaction commits**. The permanent locator/hash fence prevents delayed registration/submission from reviving work. Never reuse locator/credential or delete that fence. Only after explicit clear receives this acknowledgement may browser integration atomically delete the existing record across tabs; delayed responses must not recreate it.

If submission commits first, return `committed` without changing operation/access/appointment data. This classification requires no decryption and survives replay expiry/missing keys until trusted pruning. It does not authorize local removal/replacement: recover separately; committed-forget needs its own contract. Fencing never cancels an appointment or removes confirmation access. Timeout, rollback, driver error, or lost acknowledgement remains unknown; retain/retry the same pair.

## Retention and rollback

Pruning is trusted maintenance, not a guest reset endpoint or an implicitly authorized scheduled job. Lock/reread the operation; pending becomes a tombstone at its original deadline, committed only at original confirmation expiry after checking authoritative appointment expiry. Inconsistent metadata fails without deletion.

Atomically remove access/replay/fingerprint/key material and the operation's appointment association; retain appointment/contact/service/occupancy history. Keep terminal locator/hash/state and original timestamps **indefinitely**. Cleanup never creates intents; browser clear/reset never deletes the server fence.

Rollback means stop invoking integration—not reset history, delete tombstones, retire live keys, or bypass recovery through the raw booking transaction. Never log credentials, contacts, notes, canonical payloads, fingerprints, SQL bind parameters, function arguments/results, or raw database errors. Private confirmation-link transport remains separately scoped; backend replay alone proves no browser journey.

## Canonical agreement v1

Identity includes version, staff, ordered service IDs, UTC start instant, ordered reviewed-service consent values, trimmed required contact fields, verbatim note (omitted = empty), and submitted phone country (omitted = null). Object property order/equivalent timestamp offsets are irrelevant; service order, phone formatting, email case, and note whitespace remain meaningful.

Canonicalization must not consult changing catalog/country defaults. Copy validated fields before asynchronous work; never persist plaintext canonical agreements. Exact serialization order/crypto representation live in implementation and compatibility tests—changing them requires explicit version/compatibility review, not incidental refactoring.
