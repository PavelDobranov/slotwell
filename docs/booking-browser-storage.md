# Retained browser booking intents

`src/app/_lib/booking/intent-storage.ts` provides allocation and discovery only. It is not wired to submission or the wizard. The human-approved browser-storage direction permits same-origin JavaScript to read recovery credentials: an XSS compromise can steal them. Never log these records, include them in URLs, or capture them in browser traces/screenshots. Contacts, notes, agreements and confirmation tokens are not stored here.

## Contract

- `allocateBookingIntent()` creates one independent intent, not a retry. It returns exactly `{ operationId, credential }`: a cryptographically random UUID locator and an independent 32-byte random lowercase hexadecimal credential. Await its fulfilled promise **before** registration or submission. A rejected allocation returns no usable pair and must prevent networking; do not fall back to memory, cookies or localStorage.
- `listBookingIntents()` discovers retained pairs for later recovery integration. It does not register, submit, resolve, clear or authorize replacement. It fulfills only after its readonly transaction completes. No ordering is promised.
- IndexedDB database `slotwell-booking-intents`, version 1, contains one `intents` store keyed by `operationId`, with a unique `credential` index. Each record contains only those two primitive strings. Globals are accessed on invocation, not import; invoke only in a browser.
- Allocation checks schema and retained records, reads at most 17 records and inserts with `add` inside **one readwrite transaction**. Overlapping readwrite transactions on that store serialize across same-origin tabs, including first initialization. At 16 or more valid retained records, allocation refuses with `intent_capacity_reached`. It never overwrites or evicts a record. List refuses excess records; both refuse malformed records/schema rather than repair them.
- Allocation requests strict durability and checks that the transaction actually reports `strict` before inserting. Request success alone is insufficient: allocation fulfills only on transaction `complete`. Storage failure/abort, blocked open, incompatible version/schema, missing APIs/entropy or collision returns only `intent_storage_unavailable`, without a nested cause. There is no automatic collision retry or replacement allocation.
- Each connection closes after use and on version change. A blocked open is refused immediately; if it later succeeds, its handle is closed without performing an allocation. No delayed server response can write to this store: there is no update/reinsert API.

This cap covers app-managed records within one origin/storage partition, not other profiles, partitions or manually tampered storage. Browser-managed eviction or explicit site-data clearing can destroy credentials. Strict transaction durability is not a backup or a promise against device/browser failure. The application does not expire, abandon or remove records automatically.

## Lifecycle integration boundary

Use the same retained pair for registration retries, unknown submission outcomes and recovery. Calling allocation again is an explicit new intent, not a recovery mechanism. Listing is not evidence that registration occurred, or permission to submit/replace anything. Tab selection/pointers and ambiguous-intent recovery UX are not implemented by this module.

There is deliberately no deletion API yet. Explicit clear must durably fence pending/in-flight server work before atomically releasing local capacity; committed-forget remains separately gated. Capacity can remain exhausted until that integration. Never remove an intent based on a pending snapshot, expiry, an unavailable response or a lost acknowledgement. See [backend operation lifecycle](booking-retries.md). No PostgreSQL schema, HTTP lifecycle/submission, UI integration or private confirmation behavior is delivered by allocation alone.

To roll back runtime integration, stop calling this module; do not delete its database, replace its credentials or reset server fences.

## Focused verification

Run the isolated Chromium integration tests with the already installed Playwright browser:

```sh
npx tsx --test src/app/_lib/booking/intent-storage.browser-test.ts
```

This deliberately separate `.browser-test.ts` suffix keeps browser requirements out of `test:unit`. The test launches a fresh isolated browser context per case, transpiles the actual storage module using installed TypeScript and intercepts localhost document/module requests. No dev server, real credentials, personal browser profile or trace artifacts are used. Only counts/booleans leave the browser. The tests exercise cross-tab allocation, capacity, tab closure/reload, actual IndexedDB transactions with injected aborts/failures, corruption and blocked-open cleanup. They do not establish end-to-end booking recovery or full wizard browser acceptance. The focused harness uses Playwright Chromium rather than Chrome DevTools MCP.

Platform references: [transaction scheduling](https://w3c.github.io/IndexedDB/#transaction-scheduling), [durability options](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction), [transaction completion](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event).
