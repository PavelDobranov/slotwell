# M1 acceptance evidence

Evidence for [#78](https://github.com/PavelDobranov/slotwell/issues/78), under
[specification #53](https://github.com/PavelDobranov/slotwell/issues/53) and
[approved plan #54](https://github.com/PavelDobranov/slotwell/issues/54).
**Human M1 acceptance is pending.** This record is not milestone closure,
default-branch merge approval, a production-readiness claim or a substitute for
the GitHub approval/progress record.

## Reproduction context

Local run on 2026-10-30: Node 26.8.1, npm 11.19.0, Linux, installed Playwright
Chromium, digest-pinned PostgreSQL 18.6. Baseline `7d0b2a5`; security tests added in
`804bb59` and `144c6e3` on `feature/m1-persisted-booking`. No runtime, dependency, migration,
product-policy or accepted UI changes. Architecture boundaries were manually
reviewed; automated architecture enforcement remains an approved deferral.

## Commands and actual outcomes

| Command | Result |
| --- | --- |
| `npm run build` | Pass; `/book`, `/confirmation` and API adapters compiled. Existing external-parent-lockfile warning. |
| `npm run lint` | Pass, three existing reduced-motion CSS `!important` warnings. An initial formatter error in the new HTTP test was corrected; no rule suppression. |
| `npx tsc --noEmit` | Pass. |
| `npm run test:unit` | 511 passed, zero failed/skipped. |
| `npm run test:db` | 180 passed, zero failed/skipped, including production-process lifecycle and Hono CLI checks. Final run after test-review corrections. |
| `SLOTWELL_BROWSER_TEST=private-schema-v1 npm run test:e2e` | 11 passed, zero failed/skipped, two Chromium workers, private PostgreSQL schemas/owned production servers. |
| `npx tsx --test src/app/_lib/booking/intent-storage.browser-test.ts src/app/_lib/booking/intent-association.browser-test.ts` | 23 passed, zero failed/skipped, isolated Chromium contexts. |
| `npm run test:e2e` | Incomplete: external 600-second command limit, 9 passes and 49 failures observed of 183 selected tests; no final suite verdict. Original assertions unchanged. |
| `npm run test:e2e -- --workers=6` | Completed all 183 original tests in 13.6 minutes: 78 passed, 105 failed, zero skipped (exit 1). Worker count changed only; no assertion/timeout/retry policy changes. |
| `npm run test:e2e -- e2e/booking-chrome.spec.ts --grep 'desktop summary remains'` | Reproduced failure: prototype rail expected 340px, measured 388.781px. No prototype/CSS/runtime source was changed by #78. |
| `npx hono --help` | Pass, installed CLI 1.0.0-rc.8. Full DB suite also executes private-schema POST/replay, lifecycle and confirmation CLI checks, withholding private output. |
| `npm audit --ignore-scripts --json` | Three low findings, zero moderate/high/critical; see below. No automatic remediation. |

The ordinary browser run selects the prototype/mocked suites, not real-database
journeys. Its failing result is **not** replaced by the 11 passing persisted tests.
All 27 mocked persisted/recovery/private-confirmation checks passed (18/3/6).
The 105 failures are in unchanged prototype files: baseline 12, accessibility 18,
chrome 28, details 2, mobile 14, services-design 1, recovery 4, theme 2, booking 24.
Reported failure classes were 71 test timeouts, 33 assertion failures and one
strict-mode locator ambiguity. Historical prototype selector/layout failures and timeout were
already recorded in #66/#67 and the post-refactor #54 checkpoint; #77 acceptance
explicitly excluded full historical-suite green. The new run confirms failures
remain, not that every historical failure has been individually baseline-compared.

## Fresh disposable PostgreSQL onboarding

The [setup guide](postgresql.md) was exercised against a **new PostgreSQL cluster**,
not merely an already-migrated database or a reused private schema:

- Generated fresh mode-0600 credentials/key rings using the documented script;
  executed the documented role/database/bootstrap SQL verbatim, including
  `btree_gist` in both databases.
- Used the same pinned image and loopback port 55432, with a uniquely named/labeled
  temporary container and tmpfs data directory, no shared volume. Temporarily
  stopped the existing project service; no other PostgreSQL instance was touched.
- `npm run db:migrate` twice, `npm run db:seed` twice, then `npm run db:smoke`:
  all passed using explicit fresh environment values (no overwrite of the
  checkout's `.env.local`).
- Started the compiled production application on free owned loopback port 3198,
  with the matching trusted origin. Database-backed `/api/catalog` returned
  12 services; `/book` returned 200. This is startup/onboarding evidence, not a
  second full UI journey on that application database.
- Stopped and awaited that application process, verified the temporary container's
  exact ownership label, removed only that container/tmpfs, then restored the
  original project service healthy. Deleted only the verification's owned temporary
  credential directory. No shared/developer database, volume, schema or history reset.

Application-restart persistence is separately exercised by
`src/server/booking/submit-booking.db-test.ts` across distinct exited/restarted
processes against the same owned schema. PostgreSQL restart durability was
recorded in accepted #56 provisioning evidence, not rerun against shared data here.

## Security and product evidence map

Source/tests own exact executable details; these links map requirements to the
checks run above rather than introducing a second security contract.

| Guarantee | Executable evidence |
| --- | --- |
| Invalid, crossed appointment tokens, service-end + 168 elapsed-hour expiry (equality expired), read-only history | `src/server/booking/confirmation.db-test.ts`; `src/server/http/confirmation.routes.db-test.ts` adds two valid appointments crossed in both directions over HTTP. Expiry retains history. |
| Malformed primitives/UTF-8, body-byte limits, strict fields, trusted Origin, media/method rejection, private error/status/header handling | `src/server/http/{booking,booking-intents,confirmation}.routes.db-test.ts`, including Next dispatch and Hono CLI checks. |
| Exact private response allowlists; no contact/profile/notes/internal rows or token in confirmation views | Confirmation application/HTTP tests compare exact ordered snapshot fields; submission HTTP tests allow only the private receipt; lifecycle tests distinguish pair-only states. |
| Credentials cannot disclose client profiles or overwrite prior contact snapshots | `src/server/booking/book-appointment.db-test.ts`, `submit-booking.db-test.ts`, `src/db/booking.db-test.ts`. Matching phone is not ownership proof. |
| Authoritative catalog/qualification/schedule/time/occupancy rules and transactional conflicts | `src/server/availability/{compute.test,queries.db-test}.ts`, `src/shared/booking-time.test.ts`, `src/db/scheduling.db-test.ts`, booking application/DB tests. Includes time-zone/DST, buffers, touching boundaries, lead/horizon and separate-connection races. |
| Snapshot stability and retry/unknown-outcome recovery, including process restart | `src/server/booking/{book-appointment,operations,submit-booking}.db-test.ts`; no rebooking on identical retry or lost receipt. |
| UI success/reload, validation/back/edit preservation, real conflict, generic transport failure, lost-response reload/tab closure recovery | `e2e/persisted-real-journeys.spec.ts`, actual HTTP/PostgreSQL except deliberate transport faults. |
| Keyboard/focus/names/status, narrow/desktop layouts, device/business-zone separation | `e2e/persisted-real-accessibility.spec.ts`, 390px and 1280px. Automated evidence only, not human visual/screen-reader/WCAG certification. |
| Browser storage and referrer leakage | New `e2e/persisted-real.spec.ts` UI journey checks localStorage empty, locator-only sessionStorage, exact pair-only IndexedDB record shape, matching tab locator, no contacts/notes/receipt fields or confirmation token disguised as the retained credential; request URL/header checks, console/page-error counts, and intercepted Maps popup verify allowlisted destination and absent Referer without sending third-party traffic. Only booleans/counts leave the disposable fictional profile. |

## Logging, links and artifact inspection

The new HTTP test captures console log/info/warn/error/debug for successful,
crossed, malformed and injected driver-error paths and asserts no logs; error
body checks withhold actual response data even on failure. A deliberate mutation
adding raw-error logging to the route caused the new test to fail; restoring the
route returned it to green. This is a regression-test validation, not a runtime
behavior change.

Source inspection of booking/HTTP, persisted browser clients and confirmation
found no request/contact/credential/receipt logging. `src/db/open.ts` disables
Drizzle logging and SQL parameters in errors; its idle-pool diagnostic is the
fixed `database_pool_idle_error`, not the raw driver error. Owned browser-server
fixtures discard child output rather than saving it. These checks do **not**
audit arbitrary host proxies, Docker log drivers, third-party telemetry or future
production infrastructure.

The confirmation fragment remains in browser history/address bar intentionally
for reloadable bearer access; it is not a server request URL. The client sends
credentials only in the POST body, uses omitted cookies/no-referrer and no-store,
and stores no confirmation token. The directions link uses noreferrer/noopener
and no-referrer; the real-browser check intercepts it locally. Retained operation
credentials in IndexedDB are the explicitly approved exception, not secret
storage protected from same-origin JavaScript. See the authoritative
[HTTP](contracts/booking-http.md), [retry](contracts/booking-retries.md), and
[browser-storage](contracts/booking-browser-storage.md) contracts.

Persisted suites disable trace/screenshots/video/DOM capture before private
navigation, reject unsafe overrides, and use fictional contacts and boolean-only
private assertions. No private receipts, raw exceptions, URLs, contacts or database
credentials are attached to this evidence. Ordinary prototype failure artifacts
are not persisted acceptance evidence; do not upload them indiscriminately. Follow
[artifact and cleanup rules](browser-testing.md), including no leftover-schema reset.

## PostgreSQL-only and dependency review

Verified cleanup commit `05de670` rather than repeating SQLite removal:
`package.json`, runtime DB/schema/tooling and current installed dependency tree
use PostgreSQL; `npm ls better-sqlite3 @types/better-sqlite3 @libsql/client --all`
reports an empty tree. Drizzle's optional-peer metadata in the lockfile still
mentions other drivers; that is not an installed SQLite runtime. SQLite URL and
legacy-environment strings remain in rejection tests only. No package changes.

The audit reports `deepmerge` prototype poisoning
([GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)) propagated
through `@shadcn/registry` to `shadcn`, all low severity. No imports of these packages
were found in application/scripts; the observed path is registry/CLI tooling,
not booking request handling. Do not process untrusted registry inputs. Automated
remediation proposes a breaking shadcn downgrade and is not authorized here.
Review the tooling advisory before next registry use/upgrade, no later than
2026-11-30. This is a bounded audit result, not proof of supply-chain safety.

## Acceptance boundary

Human review remains required for M1/#53. Review the Bulgarian real-booking copy,
prototype separation, visual/responsive usability and assistive-technology behavior;
resolve or explicitly accept relevant historical browser failures without deleting
or weakening their checks. No unsupported email/change promises are approved.
Local database owners, absent production throttling/deployment hardening and a
production PII retention/erasure programme remain limitations, not completed work.
No cloud deployment, persisted time-first, management UI or client change actions
were added. Closing #78, if accepted, resolves only its own deliverable/dependency;
it does not close #53/#1 or grant aggregate acceptance.
