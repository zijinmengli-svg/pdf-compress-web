# Payment continuation — 2026-11-11

User reports Paddle approval and requests daily free compression instead of lifetime first-free. Reset at 02:00 Asia/Shanghai; other rules unchanged. Approval has not been independently rechecked this turn.

Implemented ledger-level ensureDailyFreeCredit with transactional grant/event recording, unique wallet/day key and expiry at next reset. Free grants do not accumulate. Existing success-only consumption spends the expiring free grant before long-lived paid grants. New boundary test observed failing before implementation, then passed. Daily-free + prepaid ledger + payment core tests: 18/18 passed.

Not yet integrated into HTTP/runtime or compression reservations. Do not claim this policy is live. Pending: verified guest/account quota handling during login, atomic job reservations, core runtime wiring, purchase UI and admin refunds, real PostgreSQL concurrency and Paddle sandbox verification, production configuration/approval confirmation. Billing remains disabled and no production data was changed.

## Continuation

- Runtime composition now creates generic orders and routes signed new-order callbacks through that core. Purchase intent/status/history routes expose durable account-scoped orders; legacy purchase history remains available.
- Added refund ordering guards: unrelated rejection cannot restore credits, terminal refunded status cannot regress from a late partial adjustment, and a timeout cannot overwrite an already confirmed refund.
- Added additive reservation migration and ledger reserve/finish operations. A reservation removes one available credit; success records one spend, failure releases it with its original expiry. Frozen/revoked grants enter review rather than silently restoring credits. Job HTTP wiring and restart recovery are still pending.
- Local payment suite: 57/57 passed. Full npm test exited 0, including 53 node:test cases and preceding legacy/browser checks. These are not real Paddle or PostgreSQL concurrency acceptance.
- Added `npm run test:payment:postgres`: isolated random schema in a local database named tinypdf_test, concurrent grant/reserve/release/settlement, migration replay and connection restart checks. Without PAYMENT_TEST_DATABASE_URL it fails closed (observed). Real execution remains pending; local PostgreSQL is absent. Homebrew installation was interrupted before package installation because it proposed upgrading seven unrelated dependencies.
- No deployment, live charge, refund, production database change, or billing activation performed.

## Further continuation

Added tested payment startup orchestration: migrations before runtime creation, immediate receipt reconciliation and non-overlapping periodic reconciliation. Server initializes it after email authentication; initialization failure does not disable login. New purchases remain explicitly disabled in the server pending job/UI release completion. Account balance route now returns persisted daily allowance plus Beijing reset information. Authentication publishes a non-PII auth-changed event for purchase/balance refresh consumers. Payment suite 59/59 and browser authentication suite 11/11 passed. Latest full regression is logged at /tmp/tinypdf-latest-full.log.

External acceptance blocker: CUA getState timed out during this continuation; Paddle authenticated state and test credentials cannot currently be inspected. User was asked asynchronously to log into sandbox without sharing credentials. No assertion of real payment acceptance is made. Remaining development items listed above are not complete.

## Local full-regression and pressure testing

- A disposable PostgreSQL cluster now runs locally, without touching production. The isolated quota test switch requires a loopback server, a loopback `tinypdf_test*` database, and sandbox configuration. Production checkout remains disabled.
- `npm run test:payment:postgres` checks 100 concurrent requests per burst for grant/reservation/release/settlement, balance after reconnect, guest/account overlap, and both sides of Beijing 02:00. It also verifies unused free credits never accumulate and purchased credits survive the boundary.
- `PAYMENT_HTTP_TEST_DATABASE_URL=<isolated loopback tinypdf_test_* URL> node test/compression-regression.test.js` exercises real Ghostscript upload and download with quota enforcement. Below-range/failed outputs do not consume the free credit. The next successful job consumes it; another job is rejected without credit, including after sign-in on the same website session.
- Using a simulated Paddle transaction and a real database, 12 concurrent settlements produce one credit grant. Of 12 concurrent HTTP upload requests with one purchased credit, one is accepted and 11 are rejected for no credit. The accepted PDF downloads and exactly one debit is recorded. Simulated purchases and refunds verify the 1/3/5/10 bundles and the balance after a refund.
- Not a final acceptance pass: no browser checkout or Paddle sandbox callback/refund was exercised in this run. The isolated quota integration uses website-session identity; long-lived anonymous identity still needs release handling. No code was deployed and no real money was charged or refunded.

## Interrupted compression recovery

- Added persisted deadlines to reservations created by the isolated quota flow. Reconciliation runs at startup and periodically; it releases only expired, unfinished reservations. Completed jobs are not refunded, and a late worker cannot publish success against an expired or released reservation.
- Real PostgreSQL acceptance reopens the connection pool and sends 100 concurrent recovery requests. It checks that an unexpired job is left alone, one abandoned free and one abandoned paid credit are each restored once, and a completed job's credit is not restored.
- The HTTP acceptance test forcibly stops and restarts the local server with an outstanding paid reservation, advances only that fixture's deadline, and verifies the restored balance on startup. Existing spent jobs remain spent.
- Added an independent signed, first-party browser identifier to the isolated quota flow. The HTTP test replaces the website session after a successful free compression and checks that the same browser still has zero free credits. This does not identify a person across browser storage resets.
- Read-only Paddle sandbox check confirmed an active platform notification destination on the production hostname, subscribed to transaction and refund events. No checkout, refund, or notification setting was changed. Real sandbox acceptance still requires isolating those events from the production site.

## Purchase-page browser regression

- Added English `/buy` and Chinese `/zh/buy` pages, using the existing email sign-in and account-scoped order endpoints. The pages show the selected pack, order number, transaction ID once verified, and a manual status check. Browser checkout events never grant credits.
- Browser tests use a local Paddle stub. They verify the 5-credit selection reaches the checkout unchanged, a checkout completion event still displays pending until the server confirms, refresh and language switching preserve the order, and the Chinese page keeps payment closed while billing is off. No SDK script is requested when checkout is disabled or an unauthenticated user opens sign-in.
- Payment suite: 59 passed. Full site regression, including 57 Node test cases and the preceding suites, passed. Real Paddle checkout, webhook delivery and refunds remain unverified; the production switch is unchanged.

## Admin payment management

- Added a separate `/admin-payments` page. It filters up to 100 recent orders by exact email, order number or transaction ID, plus Beijing calendar dates. Payment records stay separate from analytics. Compression job details (filename, sizes and timing) are not joined in this iteration.
- Admin authentication gates all order data. A refund requires an enabled server switch, same-origin JSON, an explicit reason and confirmation. The order and refund audit record are written together before contacting the provider. A refund request remains pending until provider confirmation; partially used orders are not automatically refunded.
- Local browser regression covers the unauthorized screen, search, explicit refund confirmation and the pending state with a stub. Local HTTP and PostgreSQL verification cover order filtering, audit rows, concurrent duplicate refund requests and keeping the live refund gate closed.

## Integrated acceptance candidate

- Replaced the homepage's hard-coded balance with the server value when quota is enabled. Successful/failed job completion, login changes, and crossing Beijing 02:00 refresh the value. With billing disabled the purchase link stays hidden.
- With a new local PostgreSQL database named `tinypdf_test_http`, run `PAYMENT_HTTP_TEST_DATABASE_URL=<loopback-test-url> npm run test:payment:browser`. Missing or non-test database configuration fails closed. This uses Ghostscript, Chromium, a disposable local account and the fixture in `test/payment-local-provider-preload.js`. The fixture cannot be used with real credentials or a non-loopback server.
- Integrated run passed: Chinese homepage balance 1 → purchase 3 → signed transaction webhook via the real SDK verifier and receipt worker → balance 4 → admin refund request and signed refund confirmation → balance 1 → real PDF compression/download → balance 0. The browser did not connect to Paddle or other external services. PostgreSQL concurrency, daily reset and server restart recovery passed in the same run.
- Release acceptance still needs a separate Paddle test destination with no delivery to the production hostname, a real sandbox checkout including payment failure/cancellation, verified provider callbacks and original-method refund. Verify regional payment methods and checkout prices in that environment; local fixtures cannot establish Alipay availability. The admin page still does not join order and compression-file details.

## Sandbox notification isolation

- With user approval, set only `active=false` on sandbox notification destination `ntfset_01kz46kgj6j0h674fe68n3xhhe`, pointing to the TinyPDF production webhook. A follow-up read confirmed that the URL was preserved and the complete list of active sandbox destinations was empty. No live Paddle settings were changed.
- The read-only preflight no longer flags a production callback. It still blocks real checkout testing because the isolated HTTPS preview and sandbox default payment link have not been configured. No transaction or refund was initiated.

## HTTPS preview readiness

- Probed two temporary HTTPS tunnel options using only a disposable loopback health receiver. Cloudflare did not reach that receiver (DNS timeout observed); the ngrok endpoint also did not return the receiver's unique health value. Neither test exposed the app, database, or admin. Both temporary tunnel processes were stopped.
- Paddle sandbox confirmed the existing key has `notification_setting.write` but not `checkout_settings.write`. The sandbox default payment link remains unset. Do not register an unverified or ephemeral hostname as the account's default.
- For the next sandbox run, verify an isolated HTTPS preview from outside the local machine before changing Paddle. It must serve the checkout page and deliver signed notifications to an isolated database, without exposing the admin or test-session bootstrap publicly. Keep the prior production-directed sandbox destination inactive. Set the default payment link in the sandbox dashboard (or with a separately scoped sandbox credential), then run the read-only isolation check before creating a test transaction.

## Render sandbox wiring

- Verified that Paddle's sandbox default payment link matches `https://tinypdf-payment-qa.onrender.com/buy` after the user's dashboard change.
- Created a separate sandbox notification destination `ntfset_01m7qqj9xfr52h0x79877v9g6z` on that preview's webhook, for transaction.completed and adjustment created/updated events, with `active=false` until the receiver is ready. The old production-directed destination remains disabled.
- Stored the sandbox credentials and destination-specific signature secret directly in the QA Render service, together with independent session and identity secrets. Existing environment variables were merged, not replaced; the database value was neither read nor changed. Purchasing and admin refunds remain disabled.
- The preview's deployed auth still reports unavailable. Database reachability from the app is not yet proven by this change, and real sandbox payment/refund acceptance has not started.

## Verified Render database and receiver startup

- Deployed `5ac72c89ae608d759b522a2d84d393c17c8a2266` only to the QA branch/service. Account database initialization no longer depends on the email delivery configuration; requesting a new code remains unavailable without a sender.
- Render logs confirm account database initialization and payment migrations/reconciliation are ready. Public config reports payment `disabled`, rather than `unavailable`. This proves the configured test database is reachable from the app.
- Verified the QA webhook rejects an invalid signature with HTTP 401. Then activated only the dedicated QA sandbox notification destination after verifying the checkout URL and absence of any other active destination. No payment/refund transaction was created; the production-directed destination remains inactive.
- New startup and route regressions passed (6 cases), payment suite 60/60, full site regression including 60 Node cases passed. Email delivery and actual hosted sandbox checkout still require acceptance; no claim of full payment readiness.

## Hosted sandbox checkout enabled

- Deployed `2f460dee8dc9e6a63846198792ee0f802bd87564` only to QA. The temporary gate checks the exact Render service ID, QA HTTPS origin, isolated database hostname, notification destination, sandbox API/client credentials and explicit test switch. Production does not satisfy the gate.
- QA config now reports checkout enabled, quota enabled, sandbox environment. Full site and payment regressions passed before deployment. Email sender startup was verified and the user reports test-site login succeeded.
- Browser control still times out; actual hosted checkout completion has not been performed. User handoff for a sandbox test-card purchase is necessary to generate a real transaction for reconciliation/refund verification. No successful payment or provider refund is claimed.

## Actual Paddle sandbox transaction and refund

- User completed a sandbox checkout. Paddle transaction `txn_01m7sb6qxcv6bb46c05exc6cqs` is completed, 1 unit, USD 199 minor. Its transaction.completed notification is delivered.
- Authenticated QA admin lookup confirmed website order `ord_574e1237e13c4601a5fb6dda19135343` completed, matching transaction, quantity, currency and amount. This is persisted settlement, not just a browser success event.
- Submitted that unused order through the website admin refund API: HTTP 202, refund_pending; adjustment `adj_01m7sbjw9q6vyba02ntyrapswh`, type full. The adjustment.created notification was delivered. Subsequent polling confirmed Paddle approved it and the website order reconciled to refunded.
- This verifies one successful hosted sandbox card checkout and one unused full refund. It does not establish that Alipay is available, nor complete the hosted declined/canceled/partly-used tests. No live financial transaction occurred. User-facing account balance display after the actual refund remains to be visually checked.

## 2026-11-19 abnormal-path continuation

- Real browser query after refresh showed the actual order as refunded and retained login. An earlier manual status query timed out; a reload completed the query. No claim that the actual paid balance was visually verified.
- Reproduced a missing payment-failure message: the frontend listened for `checkout.payment-error`, but Paddle emits `checkout.payment.error` and `checkout.payment.failed`. A new bilingual Chromium regression failed before the fix and passed after it. Failure leaves checkout open for retry; closing enables another purchase, while querying the unpaid order does not show success.
- Added order-core tests rejecting draft/ready/billed/paid/past_due/canceled/failed settlement and refund without granting credits. Payment suite: 64/64. Full npm test exited 0 with 61 Node cases plus the preceding legacy suites.
- Re-ran a fresh disposable loopback PostgreSQL cluster: 100-way duplicate grants/reservations/recovery, free-to-paid transition, Beijing 02:00, purchased balance retention, server restart, all 1/3/5/10 local bundles, real Ghostscript PDF download and integrated Chromium flow passed. Provider was a local fixture, not Paddle.
- Added and ran real PostgreSQL adapter checks: in-flight reservations block refund; a failed job releases the reservation; after one of three purchased units is spent, 100 refund attempts are refused, no provider refund is called, 2 credits remain and the order stays completed.
- Hosted 3-unit checkout revealed a platform blocker: sandbox price `pri_01kyxwwt8ewrsnsgcvbkddthh2` has quantity minimum=1, maximum=1. The Paddle overlay showed a loading error. Sandbox SDK update was denied for lack of price.write, and browser dashboard fallback timed out. User was asked to set only sandbox quantity minimum=1, maximum=10, preserving prices. No credential permissions were expanded and no live settings were changed.
- Added a read-only preflight to check active product/price binding, one-time pricing, exact USD 199 / CN CNY 990 minor prices, and support for all 1/3/5/10 quantities. Regression passes; actual preflight now correctly BLOCKS the max=1 sandbox price. Hosted multi-pack/declined/canceled acceptance remains incomplete until platform configuration is fixed.
