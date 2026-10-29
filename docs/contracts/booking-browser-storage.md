# Browser booking-intent storage

Owns browser durability, capacity, and loss/security assumptions. [Retry semantics](booking-retries.md) own registration, recovery, and clearing; [HTTP](booking-http.md) owns transport. Allocation/discovery alone does not prove submission, wizard, or end-to-end recovery integration; consult the active GitHub task for delivery status.

## Persistence contract

- Allocate a fresh random UUID locator and independent cryptographically random 32-byte lowercase-hex credential for each **new intent**, never as a retry. Persist the pair in IndexedDB before any registration/submission. Await transaction completion, not individual request success.
- Store only the two primitive strings. No contacts, notes, agreements, or confirmation tokens. Same-origin JavaScript can read credentials: XSS can steal them. Never log records, include them in URLs, or capture them in traces/screenshots.
- Check capacity and insert atomically in one readwrite transaction, serialized across same-origin tabs, including initialization. At **16 or more** valid retained records, refuse allocation with `intent_capacity_reached`; never overwrite/evict. Discovery refuses excess records too. Refuse malformed records/schema rather than repairing them.
- Require verified **strict** transaction durability before inserting. Missing storage/entropy APIs, collision, blocked/incompatible opens, failure, or abort must prevent networking and expose only `intent_storage_unavailable`, without nested causes. No collision retry or memory/cookie/localStorage fallback. A delayed open/response must not allocate or reinsert a record.
- Discovery fulfills only after its readonly transaction completes, promises no order, and authorizes no registration/submission/replacement. Calling allocation again starts a different intent.

The cap covers app-managed records in one origin/storage partition—not other profiles, partitions, or manual tampering. Strict durability is not a backup: browser eviction, site-data clearing, or device failure can destroy credentials. The app must not expire or remove records automatically.

## Lifecycle boundary

Keep the same pair for registration retries, unknown outcomes, and recovery. A tab pointer may be copied through session storage: resuming it means recovering the same intent; an explicitly different intent needs a fresh record.

Never remove based on pending snapshots, expiry, unavailable responses, or lost acknowledgements. Explicit clear must first receive a durable server fence, then atomically release local capacity across tabs; delayed responses must not recreate the record. A committed classification does not authorize forgetting/replacement. Committed-forget requires its own reviewed contract. Without clearing integration, capacity can remain exhausted.

`clearRetainedBookingIntent` is explicit-clear orchestration, not a local reset. Its trusted callback must authenticate an owned copy of the exact pair and acknowledge only a durable server fence. No IndexedDB transaction spans networking. Callback failure/invalid acknowledgement exposes only `intent_clear_unresolved` and retains the record; `committed` also retains it. After `fenced`, a strict readwrite transaction revalidates schema/records and compares the current locator **and credential** before deleting. Absence is idempotent success; mismatch or local failure exposes `intent_storage_unavailable`. Report `fenced` only after local transaction completion. Local failure after server fencing is safely retried with the same pair. Delayed/duplicate acknowledgements never insert or recreate a record, delete another pair, or override capacity refusal. This function alone does not authorize submission or establish wizard recovery integration.

## In-memory submission coordination

A controller selects only one retained pair at a time. Discovery lists public locators without registering or auto-selecting. Explicit new-intent allocation awaits durable completion before authenticated resolution; no error starts a replacement. Resume re-reads an explicitly selected locator. Resumed pending work is recovery-only: the original agreement was not persisted, and a pending snapshot cannot exclude another tab's delayed submission. A later UI may retain a locator-only tab pointer, never contacts, agreements or receipts.

Only the original allocating controller may submit an agreement after pending resolution. It owns a synchronous allowlisted copy before awaiting storage, and retry takes no changed agreement. Any unknown submission latches uncertainty: neither subsequent pending resolution nor a later rejection grants permission to change the agreement. Only initial `invalid_booking`, `invalid_contact`, `review_required`, `selection_unavailable` or `availability_conflict` submission rejection can permit edits without prior uncertainty; `payload_conflict`, `operation_unavailable`, transport failures and clear failures do not.

Every resolve/submission/retry re-reads the exact retained locator and credential before networking. Disappearance or mismatch locks out submission and replacement, not an implicit clear; the server fence still protects a request delayed after this check. Commands are single-flight across storage and networking, including synchronous observer reentrancy. Public immutable snapshots expose locators, progress, redacted codes and committed receipts in memory only, never the credential or agreement.

Committed knowledge is monotonic: later pending/errors cannot downgrade it. A known committed intent is not clearable; recover a missing receipt separately. If explicit clear receives a fence but local deletion fails, only explicit clear retry is allowed. Dispose removes in-memory state/listeners, not retained records; late results cannot publish state, recreate storage or start further networking. An already-dispatched local deletion transaction can complete, but a fence response arriving after disposal cannot authorize starting local deletion; keep that pair for a later explicit clear retry. Controller coordination does not establish wizard or independent-tab browser acceptance.

Rollback means stop invoking integration, not delete the browser database, replace credentials, or reset server fences. Exact database/schema identifiers and exported functions live in implementation/tests, not a parallel inventory here.

## Focused browser verification

```sh
npx tsx --test src/app/_lib/booking/intent-storage.browser-test.ts
```

The separate `.browser-test.ts` suffix keeps browser requirements out of unit tests. Use installed Playwright Chromium with fresh isolated contexts and synthetic data; no dev server, personal profile, or trace artifacts. Only counts/booleans may leave the browser. These tests do not establish wizard acceptance.

Platform references: [transaction scheduling](https://w3c.github.io/IndexedDB/#transaction-scheduling), [durability](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction), [completion](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event).
