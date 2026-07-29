# TinyPDF Paddle Single-Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe Paddle one-time-payment validation flow to TinyPDF: the first successful compression is free, later successful results cost USD 1.99 or CNY 9.90, paid files live briefly in private Cloudflare R2, and the existing admin reports authoritative order revenue.

**Architecture:** Keep `server-simple.js` as the native Node HTTP/compression entry point and move payment concerns into focused CommonJS modules under `lib/payment/`. PostgreSQL is the durable source for orders, free grants, financial events, webhook idempotency, and file cleanup; Paddle is the payment source of truth; R2 stores only payment-intent compressed results. The frontend opens Paddle Overlay Checkout but unlocks only by polling server state updated from a verified `transaction.completed` webhook.

**Tech Stack:** Node.js 18+, native `http`, Ghostscript, PostgreSQL via `pg`, `pg-mem` for repository tests, official `@paddle/paddle-node-sdk`, Cloudflare R2 via AWS SDK v3, static HTML/CSS/JavaScript, existing signed web sessions and admin cookie.

## Global Constraints

- Default public language is English; Chinese is shown only after the user selects it.
- Desktop is the maintained product; mobile receives basic responsive adaptation only.
- Compression stays server-side with the existing Ghostscript pipeline.
- The first successful compression per signed anonymous browser identity is free.
- Later successful results cost USD 1.99, with a China country override of CNY 9.90.
- Prices are integer minor units and remain configurable from the TinyPDF admin.
- Admin price changes create a new Paddle one-time price version first, then atomically switch local settings; existing orders keep their snapshotted old price ID and amount.
- Only a verified Paddle `transaction.completed` webhook unlocks a paid result.
- Frontend Paddle events are never payment authority.
- Webhook HTTP handling verifies the raw signature, stores only a minimal durable inbox record, and returns within Paddle's five-second delivery window; all Paddle/R2 reconciliation runs in a retryable worker.
- Only a session-bound successful compression may create an order, prepare R2, or open checkout.
- Original PDFs and free results never enter R2.
- A paid-flow result enters private R2 only after the user clicks `Pay and download`.
- Normal result retention is one hour; a one-day R2 lifecycle rule is only a safety fallback.
- R2 object keys and metadata contain no original filename, email, IP address, or PDF content metadata.
- Revenue events use USD payout-currency deltas; original USD/CNY customer totals are never summed together.
- Admin labels revenue as Paddle net earnings before Payoneer fees and China personal tax.
- `libindesign.cn` attribution requires exact `libindesign.cn` or `www.libindesign.cn` referrer/UTM evidence; unknown traffic remains direct/unknown.
- AI crawlers may index public pages but cannot invoke compression, storage, checkout, or download capabilities.
- Billing acceptance defaults off and fails closed unless PostgreSQL, Paddle, webhook, price, R2, stable website-session, and stable identity-hash configuration are healthy.
- The billing kill switch blocks new paid orders and checkout preparation, but the durable runtime, webhook intake/worker, paid-order status/download, cleanup, refunds, and admin reconciliation remain available for existing orders.
- Do not introduce accounts, credit packs, subscriptions, browser compression, email delivery, mobile-specific flows, or a public compression API.

---

## File Structure

### New server modules

- `lib/payment/config.js` — validate environment configuration and expose only safe public price/checkout settings.
- `lib/payment/money.js` — integer minor-unit validation and financial delta helpers.
- `lib/payment/security.js` — anonymous-identity hashes and opaque order capability tokens.
- `lib/payment/database.js` — PostgreSQL pool, transaction helper, and migration runner.
- `lib/payment/repository.js` — all order, grant, settings, event, webhook, and file-object SQL.
- `lib/payment/order-service.js` — free-grant decision, order state transitions, authorization, and download eligibility.
- `lib/payment/paddle-client.js` — Paddle SDK creation, transaction creation, price sync, webhook verification, refunds, and transaction retrieval.
- `lib/payment/r2-store.js` — private object upload/checksum verification, signed URL creation, and delete.
- `lib/payment/checkout-service.js` — orchestrate R2 preparation before Paddle checkout.
- `lib/payment/webhook-service.js` — idempotent financial recognition and adjustment handling.
- `lib/payment/webhook-worker.js` — claim and reconcile durable webhook inbox records outside the HTTP delivery window.
- `lib/payment/cleanup-service.js` — expire Railway/R2 results and retry deletion.
- `lib/payment/admin-service.js` — admin summaries, orders, events, settings, and health.
- `lib/payment/rate-limit.js` — bounded per-session/IP-prefix payment preparation controls.
- `db/migrations/001_payment_schema.sql` — durable schema and constraints.

### New browser modules and pages

- `public/payment.js` — Paddle.js setup, pay button, status polling, and signed-download handoff.
- `public/admin-payments.js` — payment settings, revenue cards, order table, and order timeline.
- `public/refund.html` — public refund policy.

### Modified files

- `package.json`, `package-lock.json` — dependencies and test commands.
- `server-simple.js` — initialize payment runtime, connect compression success to orders, route payment/admin/webhook endpoints, and schedule cleanup.
- `lib/web-session.js` — exact personal-site attribution and reusable session identity helpers.
- `public/index.html`, `public/zh/index.html` — pricing/result-paywall markup and Paddle.js include.
- `public/app-simple.js` — pass completed compression state into the payment controller and gate current download behavior.
- `public/i18n.js` — English and Chinese payment/error copy.
- `public/admin.html`, `public/admin.js` — mount the payment dashboard beside analytics.
- `public/styles.css` — payment and admin-payment styling with basic narrow-screen fallback.
- `public/terms.html`, `public/privacy.html`, `public/faq.html`, `public/zh/faq.html`, `public/contact.html`, `public/sitemap.xml`, `public/llms.txt` — paid-service, privacy, refund, price, and AI-boundary copy.
- `.gitignore` — ignore `.env.payment.local` and local payment fixture output.
- `README.md` — local environment and sandbox setup.

### New tests

- `test/payment-domain.test.js`
- `test/payment-repository.test.js`
- `test/payment-order-service.test.js`
- `test/payment-r2.test.js`
- `test/payment-paddle.test.js`
- `test/payment-webhook.test.js`
- `test/payment-api.test.js`
- `test/payment-admin.test.js`
- `test/payment-ui.test.js`
- `test/payment-legal.test.js`

---

### Task 1: Payment Dependencies, Configuration, Money, and Security Primitives

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `lib/payment/config.js`
- Create: `lib/payment/money.js`
- Create: `lib/payment/security.js`
- Create: `test/payment-domain.test.js`

**Interfaces:**
- Produces: `loadPaymentConfig(env) -> PaymentConfig`
- Produces: `publicPaymentConfig(config, settings, health) -> { enabled, environment, clientToken, usdAmountMinor, cnyAmountMinor, usdDisplay, cnyDisplay, status }`
- Produces: `assertMinor(value, field) -> number`
- Produces: `money(amountMinor, currency) -> { amountMinor, currency }`
- Produces: `financialDelta(previousMinor, nextMinor) -> number`
- Produces: `hashAnonymousIdentity(sessionId, secret) -> string`
- Produces: `createOrderCapability() -> { token, tokenHash }`
- Produces: `hashOrderCapability(token) -> string`
- Produces: `verifyOrderCapability(token, expectedHash) -> boolean`

- [ ] **Step 1: Install the production and test dependencies**

Run:

```bash
npm install pg @paddle/paddle-node-sdk @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm install --save-dev pg-mem
```

Expected: `package.json` and `package-lock.json` list the five packages; no application file changes.

- [ ] **Step 2: Add the domain tests**

Create `test/payment-domain.test.js` with assertions equivalent to:

```js
"use strict";
const assert = require("assert");
const {
  loadPaymentConfig,
  publicPaymentConfig,
} = require("../lib/payment/config");
const { assertMinor, money, financialDelta } = require("../lib/payment/money");
const {
  hashAnonymousIdentity,
  createOrderCapability,
  verifyOrderCapability,
} = require("../lib/payment/security");

const env = {
  BILLING_ENABLED: "true",
  PADDLE_ENVIRONMENT: "sandbox",
  PADDLE_API_KEY: "pdl_sdbx_apikey_test",
  PADDLE_CLIENT_TOKEN: "test_client_token",
  PADDLE_WEBHOOK_SECRET: "pdl_ntfset_test",
  PADDLE_NOTIFICATION_SETTING_ID: "ntfset_123",
  PADDLE_PRODUCT_ID: "pro_123",
  PADDLE_PRICE_ID: "pri_123",
  PAYMENT_USD_MINOR: "199",
  PAYMENT_CNY_MINOR: "990",
  DATABASE_URL: "postgres://example",
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "access",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "tinypdf-paid-results",
  R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  WEB_SESSION_SECRET: "stable-web-session-secret",
  PAYMENT_IDENTITY_HASH_SECRET: "stable-payment-identity-hash-secret",
};

const cfg = loadPaymentConfig(env);
assert.strictEqual(cfg.ready, true);
assert.deepStrictEqual(publicPaymentConfig(cfg, {
  billingEnabled: true,
  usdAmountMinor: 199,
  cnyAmountMinor: 990,
}, { ready: true }), {
  enabled: true,
  environment: "sandbox",
  clientToken: "test_client_token",
  usdAmountMinor: 199,
  cnyAmountMinor: 990,
  usdDisplay: "$1.99",
  cnyDisplay: "¥9.90",
  status: "ready",
});
assert.strictEqual(loadPaymentConfig({ BILLING_ENABLED: "true" }).enabled, false);
assert.throws(() => assertMinor(1.5, "amount"), /integer/);
assert.deepStrictEqual(money(199, "usd"), { amountMinor: 199, currency: "USD" });
assert.strictEqual(financialDelta(139, 20), -119);

const hash = hashAnonymousIdentity("session-1", "secret");
assert.strictEqual(hash, hashAnonymousIdentity("session-1", "secret"));
assert.notStrictEqual(hash, hashAnonymousIdentity("session-2", "secret"));
const capability = createOrderCapability();
assert.strictEqual(capability.token.length >= 43, true);
assert.strictEqual(verifyOrderCapability(capability.token, capability.tokenHash), true);
assert.strictEqual(verifyOrderCapability(createOrderCapability().token, capability.tokenHash), false);
console.log("payment domain tests passed");
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node test/payment-domain.test.js`

Expected: FAIL with `Cannot find module '../lib/payment/config'`.

- [ ] **Step 4: Implement validated configuration**

Implement `loadPaymentConfig(env)` so:

```js
const required = [
  "DATABASE_URL",
  "PADDLE_API_KEY",
  "PADDLE_CLIENT_TOKEN",
  "PADDLE_WEBHOOK_SECRET",
  "PADDLE_NOTIFICATION_SETTING_ID",
  "PADDLE_PRODUCT_ID",
  "PADDLE_PRICE_ID",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_ENDPOINT",
  "WEB_SESSION_SECRET",
  "PAYMENT_IDENTITY_HASH_SECRET",
];
const requested = env.BILLING_ENABLED === "true";
const missing = required.filter(name => !String(env[name] || "").trim());
const environment = env.PADDLE_ENVIRONMENT === "production" ? "production" : "sandbox";
const usdAmountMinor = parseMinor(env.PAYMENT_USD_MINOR, 199);
const cnyAmountMinor = parseMinor(env.PAYMENT_CNY_MINOR, 990);
return {
  requested,
  enabled: requested && missing.length === 0,
  ready: missing.length === 0,
  missing,
  environment,
  usdAmountMinor,
  cnyAmountMinor,
  // copy required secret/server fields without logging them
};
```

`publicPaymentConfig()` must omit API keys, webhook secret, database URL, R2 credentials, and operator identity. Environment price/ID values bootstrap an empty `payment_settings` row only; after bootstrap, the database row is the active catalog source for public config, order snapshots, checkout, and health.
When `environment === "production"`, `PUBLIC_OPERATOR_LEGAL_NAME` is an additional required launch field; trim it for server-side Terms rendering but never expose it through `/api/config`.
Never generate website-session or anonymous-identity secrets at process startup; a restart must not invalidate existing browser/order authorization.

- [ ] **Step 5: Implement money and capability helpers**

Generate capabilities from 32 cryptographically random bytes encoded base64url. Store only a SHA-256 hash in `orders.public_token_hash` and compare hashes with `crypto.timingSafeEqual`. The order service separately verifies that the current signed website session hashes to the order's `anonymous_identity_hash` and that the order has not expired. Send capabilities in `X-TinyPDF-Order-Capability`, never in a URL or logs, and set all order/payment responses to `Cache-Control: no-store`.

- [ ] **Step 6: Run the focused test**

Run: `node test/payment-domain.test.js`

Expected: `payment domain tests passed`.

- [ ] **Step 7: Add the test to `npm test` and run it**

Modify the test script so `node test/payment-domain.test.js` runs before payment integration tests.

Run: `npm test`

Expected: all existing and new tests pass.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json lib/payment/config.js lib/payment/money.js lib/payment/security.js test/payment-domain.test.js
git commit -m "feat: add payment configuration primitives"
```

---

### Task 2: PostgreSQL Schema, Migration Runner, and Repository

**Files:**
- Create: `db/migrations/001_payment_schema.sql`
- Create: `lib/payment/database.js`
- Create: `lib/payment/repository.js`
- Create: `test/payment-repository.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `assertMinor()` from Task 1
- Produces: `createPaymentPool(connectionString) -> pg.Pool`
- Produces: `runPaymentMigrations(pool, migrationsDir) -> Promise<void>`
- Produces: `withTransaction(pool, fn) -> Promise<T>`
- Produces: `createPaymentRepository({ pool, now }) -> PaymentRepository`
- Repository methods used later:
  - `getSettings(tx?)`
  - `updateSettingsAfterPaddleSync(input, tx?)`
  - `consumeFreeGrant(identityHash, orderId, tx)`
  - `restoreFreeGrant(identityHash, orderId, reason, tx)`
  - `createOrder(input, tx)`
  - `getOrder(orderId, tx?)`
  - `getOrderForUpdate(orderId, tx)`
  - `updateOrderState(orderId, patch, tx)`
  - `attachPaddleTransaction(orderId, transactionId, tx)`
  - `upsertFinancials(orderId, financials, tx)`
  - `appendOrderEvent(event, tx)`
  - `enqueueWebhookReceipt(receipt, tx) -> { inserted, status }`
  - `claimWebhookReceipts(limit, leaseUntil, tx)`
  - `retryWebhookReceipt(eventId, safeError, nextAttemptAt, tx)`
  - `completeWebhookReceipt(eventId, result, tx)`
  - `createCheckoutAttempt(input, tx)`
  - `getActiveCheckoutAttempt(orderId, tx?)`
  - `updateCheckoutAttempt(attemptId, patch, tx)`
  - `createFileObject(input, tx)`
  - `getActiveFileObject(orderId, tx?)`
  - `markFileDeleted(fileId, deletedAt, tx)`
  - `recordFileDeleteFailure(fileId, error, nextRetryAt, tx)`
  - `listExpiredFileObjects(limit, tx?)`
  - `listOrders(filters)`
  - `listOrderEvents(orderId)`
  - `paymentSummary(range)`

- [ ] **Step 1: Write the repository tests**

Use `pg-mem` to create a real SQL-backed in-memory pool. Cover:

```js
const order = await repo.createOrder({
  id: "00000000-0000-4000-8000-000000000001",
  publicTokenHash: "token-hash",
  jobId: "job-1",
  anonymousIdentityHash: "anon-1",
  paymentStatus: "unpaid",
  fulfillmentStatus: "compressed",
  originalBytes: 5_000_000,
  targetBytes: 2_000_000,
  resultBytes: 1_900_000,
  reachedTarget: true,
  language: "en",
  country: "US",
  priceAmountMinor: 199,
  priceCurrency: "USD",
  source: "Direct",
  sourceCategory: "direct",
  sourceJson: {},
});
assert.strictEqual(order.price_amount_minor, 199);

assert.strictEqual(await repo.consumeFreeGrant("anon-1", order.id, pool), true);
assert.strictEqual(await repo.consumeFreeGrant("anon-1", order.id, pool), false);
await repo.restoreFreeGrant("anon-1", order.id, "fulfillment_failed", pool);
assert.strictEqual(await repo.consumeFreeGrant("anon-1", replacementOrder.id, pool), true);

assert.deepStrictEqual(await repo.enqueueWebhookReceipt({
  eventId: "evt_1",
  eventType: "transaction.completed",
  transactionId: "txn_1",
  payloadHash: "abc",
}, pool), { inserted: true, status: "queued" });
assert.deepStrictEqual(await repo.enqueueWebhookReceipt({
  eventId: "evt_1",
  eventType: "transaction.completed",
  transactionId: "txn_1",
  payloadHash: "abc",
}, pool), { inserted: false, status: "queued" });
```

Before consuming the restored grant, create `replacementOrder` with the same complete fixture fields as `order` but UUID `00000000-0000-4000-8000-000000000002`, `jobId="job-2"`, and `publicTokenHash="token-hash-2"`.

Also assert:

- `order_events.revenue_delta_minor` defaults to zero but never null;
- duplicate `paddle_transaction_id` is rejected;
- a file object contains no filename column;
- `paymentSummary()` sums USD payout deltas and groups customer totals by currency.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/payment-repository.test.js`

Expected: FAIL because migration and repository modules do not exist.

- [ ] **Step 3: Create the SQL schema**

The migration must create:

```sql
CREATE TABLE IF NOT EXISTS payment_schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text NOT NULL CHECK (environment IN ('sandbox','production')),
  billing_enabled boolean NOT NULL DEFAULT false,
  paddle_product_id text NOT NULL,
  paddle_price_id text NOT NULL,
  usd_amount_minor bigint NOT NULL CHECK (usd_amount_minor > 0),
  cny_amount_minor bigint NOT NULL CHECK (cny_amount_minor > 0),
  tax_mode text NOT NULL DEFAULT 'location',
  version bigint NOT NULL DEFAULT 1,
  last_sync_status text NOT NULL DEFAULT 'never',
  last_sync_error text NOT NULL DEFAULT '',
  last_synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_setting_audits (
  id uuid PRIMARY KEY,
  admin_session_hash text NOT NULL,
  old_values jsonb NOT NULL,
  new_values jsonb NOT NULL,
  paddle_result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  public_token_hash text NOT NULL UNIQUE,
  job_id text NOT NULL UNIQUE,
  anonymous_identity_hash text NOT NULL,
  payment_status text NOT NULL CHECK (payment_status IN
    ('not_required','unpaid','pending','paid','refund_pending','refunded','chargeback')),
  fulfillment_status text NOT NULL CHECK (fulfillment_status IN
    ('compressed','storing','stored','available','expired','failed')),
  paddle_transaction_id text UNIQUE,
  paddle_customer_id text,
  paddle_product_id text,
  paddle_price_id text,
  original_bytes bigint NOT NULL CHECK (original_bytes > 0),
  target_bytes bigint NOT NULL CHECK (target_bytes > 0),
  result_bytes bigint NOT NULL CHECK (result_bytes > 0),
  reached_target boolean NOT NULL,
  language text NOT NULL,
  country text NOT NULL DEFAULT '',
  price_amount_minor bigint NOT NULL CHECK (price_amount_minor > 0),
  price_currency char(3) NOT NULL,
  source text NOT NULL,
  source_category text NOT NULL,
  source_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  compressed_at timestamptz NOT NULL,
  paid_at timestamptz,
  download_url_issued_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS free_grants (
  anonymous_identity_hash text PRIMARY KEY,
  consumed_order_id uuid NOT NULL REFERENCES orders(id),
  consumed_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  restore_reason text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS order_financials (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  transaction_currency char(3) NOT NULL,
  customer_subtotal_minor bigint NOT NULL,
  customer_discount_minor bigint NOT NULL,
  customer_tax_minor bigint NOT NULL,
  customer_total_minor bigint NOT NULL,
  paddle_fee_minor bigint NOT NULL,
  transaction_earnings_minor bigint NOT NULL,
  payout_currency char(3) NOT NULL,
  payout_subtotal_minor bigint NOT NULL,
  payout_tax_minor bigint NOT NULL,
  payout_fee_minor bigint NOT NULL,
  payout_earnings_minor bigint NOT NULL,
  payout_exchange_rate text NOT NULL,
  adjusted_payout_earnings_minor bigint NOT NULL,
  reconciled_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS order_events (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  source text NOT NULL,
  provider_event_id text,
  payment_status text NOT NULL,
  fulfillment_status text NOT NULL,
  customer_amount_minor bigint NOT NULL DEFAULT 0,
  customer_currency char(3) NOT NULL,
  revenue_delta_minor bigint NOT NULL DEFAULT 0,
  revenue_currency char(3) NOT NULL DEFAULT 'USD',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS order_events_provider_unique
  ON order_events(provider_event_id, event_type)
  WHERE provider_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS webhook_receipts (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  transaction_id text,
  payload_hash text NOT NULL,
  resource_id text,
  order_hint uuid,
  processing_status text NOT NULL DEFAULT 'queued'
    CHECK (processing_status IN ('queued','processing','processed','failed','ignored')),
  processing_attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  processing_result text NOT NULL DEFAULT '',
  safe_error text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS checkout_attempts (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  attempt_key text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN
    ('created','uploading','uploaded','paddle_creating','reconcile_pending','ready','failed','canceled')),
  paddle_transaction_id text UNIQUE,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_safe_error text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS checkout_attempts_one_active
  ON checkout_attempts(order_id)
  WHERE state IN ('created','uploading','uploaded','paddle_creating','reconcile_pending','ready');

CREATE TABLE IF NOT EXISTS file_objects (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'r2'),
  bucket text NOT NULL,
  object_key text NOT NULL UNIQUE,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  checksum_sha256 text NOT NULL,
  storage_status text NOT NULL CHECK (storage_status IN ('stored','delete_pending','deleted','delete_failed')),
  stored_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  deleted_at timestamptz,
  delete_attempts integer NOT NULL DEFAULT 0,
  last_delete_error text NOT NULL DEFAULT '',
  next_delete_retry_at timestamptz,
  delete_lease_expires_at timestamptz
);
```

Add indexes for order creation time/status, event order/time, and expired file cleanup.
Add an index on `webhook_receipts(processing_status, next_attempt_at)` for worker claims. Store no raw webhook body and no full Paddle payload; after signature verification, persist only event ID/type, resource ID, transaction ID, order hint, payload hash, and safe processing state.

- [ ] **Step 4: Implement migration and transaction helpers**

`runPaymentMigrations()` must:

1. sort `*.sql` files;
2. acquire exactly one checked-out client with `pool.connect()`;
3. acquire PostgreSQL session advisory lock `7469506466` on that client;
4. apply each unseen file with `BEGIN/COMMIT` on the same client;
5. insert its filename into `payment_schema_migrations`;
6. release the advisory lock on that client, then release the client.

`withTransaction()` must always rollback on error and release the client in `finally`.
Add a concurrent two-runner migration test proving the advisory lock prevents duplicate application.

- [ ] **Step 5: Implement repository methods**

All update methods accept a `Pool` or checked-out client exposing `.query()`. Use `SELECT ... FOR UPDATE` for free-grant consumption, order payment state transitions, and webhook processing.
`consumeFreeGrant()` may atomically reuse a row only when `restored_at IS NOT NULL`; a consumed non-restored row remains permanently ineligible. `restoreFreeGrant()` is called only when the free result cannot be fulfilled because of a server-side failure.

Never interpolate values into SQL strings; use PostgreSQL parameters.

- [ ] **Step 6: Run focused and full tests**

Run:

```bash
node test/payment-repository.test.js
npm test
```

Expected: repository tests and all pre-existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add db/migrations/001_payment_schema.sql lib/payment/database.js lib/payment/repository.js test/payment-repository.test.js package.json
git commit -m "feat: add durable payment repository"
```

---

### Task 3: Anonymous Free Grant, Order State Machine, and Attribution Snapshot

**Files:**
- Create: `lib/payment/order-service.js`
- Modify: `lib/web-session.js`
- Modify: `test/web-session.test.js`
- Create: `test/payment-order-service.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: repository and security interfaces from Tasks 1–2
- Produces: `createOrderService({ repo, pool, identityHashSecret, now })`
- Produces: `registerCompressionSuccess(input) -> { orderId, capabilityToken, paymentRequired, expiresAt, price }`
- Produces: `getAuthorizedOrder({ orderId, capabilityToken, sessionClaims })`
- Produces: `authorizeFreeDownload({ jobId, sessionClaims, jobAccessToken }) -> boolean`
- Produces: `markDownloadUrlIssued(orderId)`

- [ ] **Step 1: Tighten personal-site attribution tests**

Update the existing attribution assertions:

```js
assert.strictEqual(
  normalizeLandingAttribution("https://libindesign.cn/work/tinypdf", {}).source,
  "libindesign.cn"
);
assert.strictEqual(
  normalizeLandingAttribution("https://www.libindesign.cn/work/tinypdf", {}).source,
  "libindesign.cn"
);
assert.strictEqual(
  normalizeLandingAttribution("https://notes.libindesign.cn/tinypdf", {}).sourceCategory,
  "referral"
);
assert.strictEqual(
  normalizeLandingAttribution("", {}).sourceCategory,
  "direct"
);
```

Change `isLibinDesignHost()` to return true only for `libindesign.cn` and `www.libindesign.cn`.

- [ ] **Step 2: Write order-service tests with an in-memory repository fake**

Cover these exact outcomes:

```js
const first = await service.registerCompressionSuccess(successInput({ sessionId: "s1", jobId: "j1" }));
assert.strictEqual(first.paymentRequired, false);
assert.strictEqual(fake.orders.get(first.orderId).paymentStatus, "not_required");

const second = await service.registerCompressionSuccess(successInput({ sessionId: "s1", jobId: "j2" }));
assert.strictEqual(second.paymentRequired, true);
assert.strictEqual(fake.orders.get(second.orderId).paymentStatus, "unpaid");

await assert.rejects(
  service.registerCompressionSuccess(successInput({ sessionId: "", jobId: "j3" })),
  /session/
);
```

Also assert:

- a compression failure never calls `registerCompressionSuccess`;
- simultaneous first-success calls produce exactly one free order;
- free order expiry is compression time plus one hour;
- paid-required order snapshots price, language, country, source, and exact attribution;
- capability token authorizes only the same order and session;
- capability token is accepted only through `X-TinyPDF-Order-Capability` and never appears in access logs or query strings;
- a direct visit is never rewritten to `libindesign.cn`.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
node test/web-session.test.js
node test/payment-order-service.test.js
```

Expected: new order-service test fails because the module does not exist; the tightened subdomain attribution test fails until fixed.

- [ ] **Step 4: Implement the state machine**

`registerCompressionSuccess()` must execute one database transaction:

```js
const identityHash = hashAnonymousIdentity(input.sessionId, identityHashSecret);
const orderId = crypto.randomUUID();
const capability = createOrderCapability();
const free = await repo.consumeFreeGrant(identityHash, orderId, tx);
const paymentStatus = free ? "not_required" : "unpaid";
const fulfillmentStatus = free ? "available" : "compressed";
const expiresAt = new Date(now().getTime() + 60 * 60 * 1000);
```

Because `free_grants` references `orders`, create the order first as unpaid, attempt grant insertion, then update it to `not_required/available` when insertion succeeds—all inside the same transaction.
Read the current versioned `payment_settings` row in that transaction and snapshot its active Paddle price ID and minor-unit amount into the order. Store `capability.tokenHash`; return the raw token only once to the same signed session.

Append exactly one `compression_succeeded`, one `free_grant_consumed` or `payment_required`, and zero-revenue events.
If a free result cannot be delivered because of a server-side fulfillment failure, restore its grant in the same failure transaction so the user's next successful compression remains free.

- [ ] **Step 5: Run focused and full tests**

Run:

```bash
node test/web-session.test.js
node test/payment-order-service.test.js
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/payment/order-service.js lib/web-session.js test/web-session.test.js test/payment-order-service.test.js package.json
git commit -m "feat: add first-free payment order state"
```

---

### Task 4: Private R2 Storage and Expiration Cleanup

**Files:**
- Create: `lib/payment/r2-store.js`
- Create: `lib/payment/cleanup-service.js`
- Create: `test/payment-r2.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `file_objects` repository from Task 2
- Produces: `createR2Store(config, deps?)`
- Produces: `putResult({ orderId, filePath, sizeBytes, checksumSha256 }) -> { bucket, objectKey, sizeBytes, checksumSha256 }`
- Produces: `headResult(objectKey) -> { sizeBytes, checksumSha256 }`
- Produces: `createDownloadUrl({ objectKey, downloadName, expiresInSeconds: 300 }) -> string`
- Produces: `deleteResult(objectKey) -> Promise<void>`
- Produces: `createCleanupService({ repo, pool, r2, paddle, webhookWorker, localJobs, now, batchSize })`
- Produces: `cleanupExpiredFiles() -> { deleted, failed }`

- [ ] **Step 1: Write adapter tests using fake AWS commands**

Assert:

- object key matches `results/<uuid>/<32+ random chars>.pdf`;
- object key contains none of `resume.pdf`, email, session ID, or job ID;
- `PutObject` uses `ContentType: application/pdf` and private default access;
- the uploaded stream checksum matches the local SHA-256;
- a mismatched `HeadObject.ContentLength` rejects before checkout;
- signed URLs expire at 300 seconds and set a safe response `Content-Disposition`;
- delete treats R2 not-found as success.
- cleanup locks order then file in that order, rechecks payment state after its deletion lease, and never deletes a newly paid result;
- an expired unpaid/pending order cancels its Paddle transaction before R2 deletion;
- if cancellation discovers `paid/completed`, cleanup queues reconciliation and leaves the object intact.

Write cleanup tests:

```js
const result = await cleanup.cleanupExpiredFiles();
assert.deepStrictEqual(result, { deleted: 1, failed: 1 });
assert.strictEqual(repo.files.get("ok").storageStatus, "deleted");
assert.strictEqual(repo.files.get("bad").deleteAttempts, 1);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/payment-r2.test.js`

Expected: FAIL because R2 and cleanup modules do not exist.

- [ ] **Step 3: Implement R2 Standard storage**

Construct `S3Client` with:

```js
{
  region: "auto",
  endpoint: config.r2Endpoint,
  credentials: {
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
  },
}
```

Use `PutObjectCommand`, `HeadObjectCommand`, `GetObjectCommand`, and `DeleteObjectCommand`. Do not set ACLs, public URLs, original filename metadata, or customer metadata.

- [ ] **Step 4: Implement cleanup retry policy**

Delete expired objects in batches of 100. On failure:

```js
const attempts = current.deleteAttempts + 1;
const delayMinutes = Math.min(5 * (2 ** (attempts - 1)), 360);
const nextRetryAt = new Date(now().getTime() + delayMinutes * 60_000);
```

Free Railway job cleanup stays in `server-simple.js`; this service manages durable R2 objects and marks the related order `fulfillment_status=expired` after deletion. Claim each file with a deletion lease, then lock `orders` before `file_objects`, matching the webhook worker lock order. For unpaid/pending orders, cancel the Paddle draft/ready transaction first. A cancel failure is retryable; a paid/completed response queues authoritative webhook reconciliation and prevents deletion.

- [ ] **Step 5: Run focused and full tests**

Run:

```bash
node test/payment-r2.test.js
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/payment/r2-store.js lib/payment/cleanup-service.js test/payment-r2.test.js package.json
git commit -m "feat: add private paid-result storage"
```

---

### Task 5: Paddle Adapter, Transaction Binding, Price Sync, and Refund Requests

**Files:**
- Create: `lib/payment/paddle-client.js`
- Create: `test/payment-paddle.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: validated `PaymentConfig`
- Produces: `createPaddleAdapter(config, deps?)`
- Produces: `createCheckoutTransaction({ orderId, attemptKey, priceId }) -> { transactionId, checkoutUrl, status }`
- Produces: `verifyWebhook(rawBody, signature) -> PaddleEvent`
- Produces: `getTransaction(transactionId) -> PaddleTransaction`
- Produces: `createPriceVersion({ productId, previousPriceId, usdAmountMinor, cnyAmountMinor }) -> PaddlePrice`
- Produces: `cancelTransaction(transactionId) -> PaddleTransaction`
- Produces: `findTransactionForAttempt({ orderId, attemptKey, createdAfter }) -> PaddleTransaction | null`
- Produces: `requestFullRefund({ transactionId, reason }) -> PaddleAdjustment`
- Produces: `normalizeCompletedTransaction(transaction) -> FinancialSnapshot`
- Produces: `normalizeAdjustment(adjustment) -> FinancialDelta`

- [ ] **Step 1: Write Paddle adapter tests with a fake SDK**

Assert `createCheckoutTransaction()` sends:

```js
{
  items: [{ priceId: "pri_123", quantity: 1 }],
  collectionMode: "automatic",
  customData: { tinypdfOrderId: "order-1", tinypdfAttemptKey: "attempt-1" },
}
```

Assert:

- environment is sandbox when configured;
- raw webhook body is passed unchanged to `paddle.webhooks.unmarshal`;
- invalid signature rejects;
- price version creation reads the previous price, then creates a new one-time price with base `USD 199`, all non-China overrides preserved, and exactly one `CN/CNY 990` override;
- returned price has a new `pri_...` ID under the configured product and `billingCycle === null`;
- a failed Paddle price creation throws before local settings are called;
- refund reason is `service_not_delivered` and targets the exact transaction;
- financial normalization reads actual totals, fees, earnings, payout totals, exchange rate, and adjusted totals without calculating `5% + $0.50`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/payment-paddle.test.js`

Expected: FAIL because `lib/payment/paddle-client.js` does not exist.

- [ ] **Step 3: Implement the official SDK wrapper**

Initialize:

```js
const { Environment, LogLevel, Paddle } = require("@paddle/paddle-node-sdk");
const paddle = new Paddle(config.paddleApiKey, {
  environment: config.environment === "sandbox"
    ? Environment.sandbox
    : Environment.production,
  logLevel: LogLevel.error,
});
```

If the installed SDK exposes ESM only in the resolved version, replace the static `require` with a cached dynamic `import()` inside the adapter factory; do not replace the official webhook verifier with ad hoc parsing.

- [ ] **Step 4: Normalize Paddle money**

Convert Paddle string minor units with:

```js
function paddleMinor(value, field) {
  if (!/^-?\d+$/.test(String(value))) throw new Error(`Invalid Paddle ${field}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Unsafe Paddle ${field}`);
  return parsed;
}
```

Require payout currency `USD` before creating a revenue event. If it differs, store the financial snapshot but fail reconciliation and keep billing health degraded.
Paddle list fields are replacement lists: `createPriceVersion()` must preserve all non-China `unitPriceOverrides`, replace every existing `CN` membership with one `{ countryCodes: ["CN"], unitPrice: { amount: String(cnyAmountMinor), currencyCode: "CNY" } }`, and create a new one-time price with the base `unitPrice`. Do not mutate or archive the previous price while an unpaid/pending order may still reference it.
Paddle does not support arbitrary client idempotency keys. `findTransactionForAttempt()` must scan a bounded recent transaction window and match both custom-data keys. A checkout attempt in an ambiguous create state is reconciled this way before any second create is allowed.

- [ ] **Step 5: Run focused and full tests**

Run:

```bash
node test/payment-paddle.test.js
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/payment/paddle-client.js test/payment-paddle.test.js package.json
git commit -m "feat: add Paddle payment adapter"
```

---

### Task 6: Checkout Orchestration and Abuse Limits

**Files:**
- Create: `lib/payment/rate-limit.js`
- Create: `lib/payment/checkout-service.js`
- Modify: `test/payment-order-service.test.js`
- Create: `test/payment-api.test.js`

**Interfaces:**
- Consumes: repository, R2, Paddle, capability security, current in-memory job paths
- Produces: `createSlidingWindowLimiter({ limit, windowMs, now })`
- Produces: `prepareCheckout({ orderId, capabilityToken, sessionClaims, ipPrefix, job })`
- Returns: `{ orderId, transactionId, checkoutUrl, environment }`

- [ ] **Step 1: Add failing checkout-service tests**

Cover:

- wrong session/capability returns `ORDER_ACCESS_DENIED`;
- bot user agents never reach `prepareCheckout`;
- free orders cannot create a transaction;
- expired local files return `RESULT_EXPIRED`;
- repeated calls return the existing transaction instead of uploading/charging twice;
- R2 upload occurs before Paddle transaction creation;
- R2 failure means Paddle is not called;
- Paddle failure deletes the newly uploaded R2 object or marks it for cleanup;
- limit 3 preparations per session per 10 minutes returns `RATE_LIMITED` on the fourth call;
- one active transaction and one R2 file per order.
- an ambiguous Paddle timeout sets the attempt to `reconcile_pending`; retry returns `CHECKOUT_RECOVERING` and never creates a second transaction until bounded reconciliation resolves it;
- checkout preparation extends unpaid order/file retention to one hour after the click, capped at two hours after compression;
- crash-point tests resume safely after upload, before/after Paddle create, and before/after transaction attachment.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node test/payment-order-service.test.js
node test/payment-api.test.js
```

Expected: checkout tests fail because the orchestration modules do not exist.

- [ ] **Step 3: Implement the limiter**

Use an in-memory map keyed by `session:<hash>` and `ip:<normalized-prefix>`. Remove timestamps older than `windowMs`; do not persist raw IPs.

Normalize addresses:

- IPv4: retain only the first three octets before hashing;
- IPv6: retain only the first four hextets before hashing;
- store only HMAC hashes in limiter keys/log metadata.

- [ ] **Step 4: Implement the checkout transaction**

Within a database transaction:

1. lock order;
2. confirm effective billing is enabled and `payment_status=unpaid`;
3. create or resume the order's single durable checkout attempt;
4. set `fulfillment_status=storing` and extend retention to `min(compressed_at + 2h, now + 1h)`;
5. commit before network I/O.

Then:

1. hash the local output and upload it to R2;
2. verify size/checksum;
3. create or resume the unique `file_objects` row and set attempt `uploaded`;
4. set attempt `paddle_creating` and create a Paddle transaction with order ID and attempt key in `customData`;
5. attach transaction ID to both order and attempt;
6. set attempt `ready`, `payment_status=pending`, `fulfillment_status=stored`;
7. append zero-revenue events;
8. remove the local output after durable storage is confirmed.

Compensate and record definite external failures. On ambiguous Paddle network failure, keep R2 and set `reconcile_pending`; recover by bounded Paddle transaction lookup using both custom-data keys. Never create a new attempt while an active/uncertain attempt exists. If recovery finds duplicate unpaid transactions, cancel the extras and never fulfill them.

- [ ] **Step 5: Run focused and full tests**

Run:

```bash
node test/payment-api.test.js
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/payment/rate-limit.js lib/payment/checkout-service.js test/payment-order-service.test.js test/payment-api.test.js
git commit -m "feat: prepare paid checkouts safely"
```

---

### Task 7: Verified Webhooks, Revenue Ledger, Refunds, and Chargebacks

**Files:**
- Create: `lib/payment/webhook-service.js`
- Create: `lib/payment/webhook-worker.js`
- Create: `test/payment-webhook.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: Paddle adapter, repository, R2 file state
- Produces: `createWebhookService({ repo, pool, paddle, now })`
- Produces: `acceptWebhook({ rawBody, signature }) -> { accepted, duplicate, eventType }`
- Produces: `createWebhookWorker({ repo, pool, paddle, r2, now })`
- Produces: `processPendingWebhooks({ limit: 25 }) -> { processed, failed }`
- Handles: `transaction.created`, `transaction.completed`, `adjustment.created`, and `adjustment.updated`

- [ ] **Step 1: Write completed-payment tests**

Use a fixture where:

```js
const completed = {
  eventId: "evt_completed_1",
  eventType: "transaction.completed",
  occurredAt: "2026-07-30T10:00:00Z",
  data: {
    id: "txn_1",
    status: "completed",
    currencyCode: "USD",
    customData: { tinypdfOrderId: orderId, tinypdfAttemptKey: "attempt-1" },
    items: [{
      quantity: 1,
      price: { id: "pri_123", productId: "pro_123" },
      totals: { subtotal: "199", tax: "0", total: "199", discount: "0" },
    }],
    details: {
      totals: {
        subtotal: "199",
        discount: "0",
        tax: "0",
        total: "199",
        fee: "60",
        earnings: "139",
      },
      payoutTotals: {
        subtotal: "199",
        tax: "0",
        total: "199",
        fee: "60",
        earnings: "139",
        exchangeRate: "1.0",
        currencyCode: "USD",
      },
    },
  },
};
```

Assert the HTTP acceptance path:

- verifies the unchanged raw body;
- writes one minimal queued receipt and returns without fetching Paddle or checking R2;
- duplicate event returns `{ duplicate: true }` and creates no second receipt.

Assert the worker path:

- first queued completed event marks order paid/available;
- `expires_at` becomes one hour after completion;
- financial snapshot stores actual values;
- one event has `revenue_delta_minor=139`, `revenue_currency=USD`;
- reprocessing the same receipt adds no revenue;
- wrong price/product/order/amount leaves result locked and records a safe error;
- validation requires exactly one quantity-one line item and compares its pre-tax subtotal/currency with the order snapshot; tax-inclusive/exclusive `total` is recorded but is not compared with the configured base amount;
- missing R2 object marks fulfillment failed and requests full refund.
- a recovered `transaction.created` binds only the matching active attempt/order keys and cancels any duplicate unpaid transaction.

- [ ] **Step 2: Write adjustment tests**

For an approved refund whose Paddle adjustment has `payoutTotals.earnings="119"` after recognized earnings of `139`, assert:

```js
assert.strictEqual(refundEvent.revenueDeltaMinor, -119);
assert.strictEqual(financials.adjustedPayoutEarningsMinor, 20);
```

For an approved chargeback whose payout effect (including chargeback fee) is `289`, assert `revenueDeltaMinor === -289`, cumulative adjusted earnings `=== -150`, and status `chargeback`.

Use this exact event matrix:

- `refund`/`credit`/`chargeback`/`chargeback_warning` with `status=approved`: subtract authoritative `payoutTotals.earnings` plus `payoutTotals.chargebackFee.amount` when the latter is not already included;
- `chargeback_reverse`/`chargeback_warning_reverse`/`credit_reverse` with `status=approved`: add the authoritative payout effect;
- `pending_approval`: set `refund_pending`, revenue delta zero;
- `rejected`: restore `paid`, revenue delta zero;
- repeated `adjustment.created`/`adjustment.updated`: one cumulative effect per provider event/resource state.

- [ ] **Step 3: Run the test to verify it fails**

Run: `node test/payment-webhook.test.js`

Expected: FAIL because webhook service does not exist.

- [ ] **Step 4: Implement verified idempotent processing**

HTTP acceptance order:

1. `paddle.verifyWebhook(rawBody, signature)`;
2. SHA-256 hash raw body;
3. extract only safe routing IDs from the verified event;
4. insert a unique queued webhook receipt;
5. return duplicate success if already queued/processed;
6. return `2xx` without Paddle API or R2 network calls.

Do not store the raw payload.

Worker order:

1. claim queued/expired-lease receipts with `FOR UPDATE SKIP LOCKED`;
2. fetch authoritative Paddle transaction or adjustment;
3. lock the TinyPDF order;
4. validate order/product/price/amount binding and R2 existence;
5. update financial/order records;
6. append exactly one positive/negative revenue event keyed by provider event ID;
7. mark the receipt processed;
8. on transient failure, increment attempts and schedule exponential retry; after ten attempts mark failed and expose it in admin health.
Use the same `orders → file_objects` lock order as cleanup. Run a startup compensation scan before the recurring worker loop.

- [ ] **Step 5: Run focused and full tests**

Run:

```bash
node test/payment-webhook.test.js
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/payment/webhook-service.js lib/payment/webhook-worker.js test/payment-webhook.test.js package.json
git commit -m "feat: recognize Paddle revenue from webhooks"
```

---

### Task 8: Server Integration with Compression, Payment APIs, and Cleanup Scheduler

**Files:**
- Modify: `server-simple.js:1-73`
- Modify: `server-simple.js:603-780`
- Modify: `server-simple.js:818-1170`
- Modify: `server-simple.js:1273-1295`
- Create: `test/payment-api.test.js` additions
- Modify: `test/web-access-guard.test.js`

**Interfaces:**
- Consumes: all payment modules from Tasks 1–7
- Produces HTTP:
  - safe payment fields in `GET /api/config`
  - `POST /api/orders/:id/checkout`
  - `GET /api/orders/:id/status`
  - `GET /api/orders/:id/download-url`
  - `POST /api/paddle/webhook`

- [ ] **Step 1: Add server-level failing tests**

Spawn the server with billing disabled and assert existing download remains free.

Spawn with injected test payment runtime and assert:

```text
GET  /api/config                         -> safe payment config, no secrets
POST /api/orders/order-1/checkout        -> 200 for same session/capability
GET  /api/orders/order-1/status          -> 200, no R2 object key
GET  /api/orders/order-1/download-url    -> 409 before verified payment
POST /api/paddle/webhook                 -> raw body reaches verifier
```

Assert crawler User-Agent receives `403/404` before checkout service invocation and all payment API responses carry `X-Robots-Tag: noindex, nofollow, noarchive`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node test/payment-api.test.js
node test/web-access-guard.test.js
```

Expected: new route assertions fail.

- [ ] **Step 3: Initialize the runtime without breaking free mode**

At startup:

```js
const paymentConfig = loadPaymentConfig(process.env);
let paymentRuntime = null;
if (paymentConfig.ready) {
  const pool = createPaymentPool(paymentConfig.databaseUrl);
  await runPaymentMigrations(pool, path.join(ROOT, "db/migrations"));
  paymentRuntime = await createPaymentRuntime({ config: paymentConfig, pool, jobs });
}
```

Because the current file starts listening synchronously, introduce `async function startServer()` and call it at the bottom. On payment initialization failure:

- log a safe error without secrets;
- keep effective billing disabled;
- expose degraded health in safe config;
- never silently gate a result with a broken payment runtime.

`paymentRuntime.effectiveBilling` is `environment hard-kill allow && payment_settings.billing_enabled && health.ready`. New compressions create orders/paywalls only when it is true. Webhook, existing-order status/download, cleanup, refund, and authenticated admin routes stay registered whenever the durable runtime is ready. This lets the admin enable billing without a restart and preserves existing paid fulfillment while new checkout is disabled.

- [ ] **Step 4: Bind successful compression to an order**

After result bytes are finalized but before emitting final SSE state:

```js
if (paymentRuntime?.effectiveBilling) {
  const order = await paymentRuntime.orders.registerCompressionSuccess({
    sessionId: job.ownerSessionId,
    jobId,
    originalBytes,
    targetBytes,
    resultBytes,
    reachedTarget,
    language: job.analyticsMeta.landingLanguage || "en",
    country: job.analyticsMeta.country || "",
    attribution: job.analyticsMeta,
    outputPath,
  });
  job.paymentOrderId = order.orderId;
  job.paymentCapability = order.capabilityToken;
  job.paymentRequired = order.paymentRequired;
  job.state.payment = {
    orderId: order.orderId,
    capabilityToken: order.capabilityToken,
    required: order.paymentRequired,
    expiresAt: order.expiresAt,
    price: order.price,
  };
}
```

Delete the original input in the compression worker's `finally` block on success and every error path as soon as Ghostscript no longer needs it. Keep free/decision result output cleanup at one hour and test that failed compression leaves no input file.

- [ ] **Step 5: Gate the existing download endpoint**

When effective billing is active for the job:

- permit the existing Railway download only for `payment_status=not_required`;
- return `PAYMENT_REQUIRED` for paid-required orders;
- preserve current job-access validation;
- mark the free download event in PostgreSQL and analytics.

When effective billing is disabled for a new job, preserve current free behavior exactly. Existing order routes remain functional even while the kill switch is off.

- [ ] **Step 6: Implement payment routes and webhook raw-body handling**

The webhook route must read a bounded raw body directly and must not call `readJsonBody()` before SDK verification.

All order routes require:

- valid signed website session;
- non-bot User-Agent;
- same-origin request where appropriate;
- opaque order capability token;
- no raw object keys or secrets in responses.

Capabilities are accepted only from `X-TinyPDF-Order-Capability`; all order responses use `Cache-Control: no-store`. Admin mutation routes added later also require same-origin checks and CSRF tokens.

- [ ] **Step 7: Schedule cleanup**

Run R2 cleanup:

```js
const cleanupTimer = setInterval(
  () => paymentRuntime?.cleanup.cleanupExpiredFiles().catch(safePaymentLog),
  5 * 60 * 1000
);
cleanupTimer.unref();
```

Also run one cleanup pass after startup migrations.
Run the webhook worker every five seconds with an overlap guard, and run one pass after startup. The public webhook route only calls `acceptWebhook()`; it never waits for the worker.

- [ ] **Step 8: Run focused and full tests**

Run:

```bash
node test/payment-api.test.js
node test/web-access-guard.test.js
npm test
```

Expected: all pass with billing enabled test doubles and disabled default.

- [ ] **Step 9: Commit**

```bash
git add server-simple.js test/payment-api.test.js test/web-access-guard.test.js
git commit -m "feat: connect compression to paid orders"
```

---

### Task 9: Public Payment UI and Paddle Overlay Checkout

**Files:**
- Create: `public/payment.js`
- Modify: `public/index.html:31-122`
- Modify: `public/zh/index.html:31-122`
- Modify: `public/app-simple.js:1-438`
- Modify: `public/i18n.js`
- Modify: `public/styles.css`
- Create: `test/payment-ui.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes safe config and SSE `state.payment`
- Produces global `window.TinyPDFPayment.createController(options)`
- Controller methods:
  - `configure(paymentConfig)`
  - `handleCompressionState(state, context)`
  - `startPayment()`
  - `resumeOrder()`
  - `destroy()`

- [ ] **Step 1: Write static UI contract tests**

Read the public files and assert:

- Paddle.js is loaded from `https://cdn.paddle.com/paddle/v2/paddle.js`;
- `payment.js` loads before `app-simple.js`;
- English page includes `First successful compression is free`;
- Chinese page includes `首次成功压缩免费`;
- paywall includes price, `Pay and download`, verification state, retry, and error region;
- no API key or webhook secret string appears;
- mobile CSS only stacks existing controls and does not introduce alternate mobile functionality.

Add pure-function tests for payment-state rendering:

```js
assert.deepStrictEqual(viewFor({ required: false }), { mode: "free", showDownload: true });
assert.strictEqual(viewFor({ required: true, paymentStatus: "unpaid" }).mode, "pay");
assert.strictEqual(viewFor({ required: true, paymentStatus: "pending" }).mode, "verifying");
assert.strictEqual(viewFor({ required: true, paymentStatus: "paid", fulfillmentStatus: "available" }).mode, "download");
```

Also assert `Paddle.Initialize()` runs once per page, `startPayment()` calls the same-origin checkout API with the capability header, then calls `Paddle.Checkout.open({ transactionId })`. `checkout.completed` may start polling but cannot unlock; `checkout.closed`, `checkout.error`, and `checkout.payment-error` leave a safe retry state without exposing raw provider errors.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/payment-ui.test.js`

Expected: FAIL because payment markup/module is absent.

- [ ] **Step 3: Add result-paywall markup**

Use one shared semantic structure on English and Chinese pages:

```html
<section id="payment-panel" class="payment-panel" hidden aria-live="polite">
  <p id="payment-price"></p>
  <button id="payment-button" class="btn-primary" type="button"></button>
  <p id="payment-state"></p>
  <button id="payment-retry" class="btn-secondary" type="button" hidden></button>
</section>
```

Keep the existing metrics visible before payment. Hide only the actual download action.

- [ ] **Step 4: Implement Paddle and polling controller**

Initialize:

```js
Paddle.Environment.set(config.environment === "sandbox" ? "sandbox" : "production");
Paddle.Initialize({
  token: config.clientToken,
  eventCallback(event) {
    if (event.name === "checkout.completed") beginVerificationPolling();
  },
});
```

`checkout.completed` only changes copy to `Verifying payment`; it never shows the download button.
Open the exact server-created transaction using `Paddle.Checkout.open({ transactionId, settings: { variant: "one-page" } })`; never rebuild checkout from a client-supplied price ID.

Poll `GET /api/orders/:id/status` every two seconds, stop after two minutes, and allow manual retry. On server status `paid/available`, request `/download-url` with the capability header, record `download_url_issued`, then navigate to the returned five-minute signed URL. Keep retry available for the one-hour window. Admin copy must label this metric “download links issued,” not claim byte-complete downloads that R2 cannot report to the app.

Persist only `{ orderId, capabilityToken, expiresAt }` in `sessionStorage`, not Paddle IDs or R2 keys.

- [ ] **Step 5: Integrate with compression state**

In `setStatus(state)`:

- free done state shows existing download;
- paid-required done state hides current download and calls `paymentController.handleCompressionState`;
- errors hide both payment and download;
- a new compression destroys the old payment controller state.

- [ ] **Step 6: Update CSP and localization**

Set Paddle additions explicitly: `script-src https://cdn.paddle.com`, `frame-src https://*.paddle.com`, `connect-src https://*.paddle.com`, and `img-src https://*.paddle.com data:` alongside the existing self sources. Do not add `unsafe-eval` or a non-Paddle wildcard. Keep `frame-ancestors 'none'` for TinyPDF itself.

Add all payment/error strings to `public/i18n.js`; do not branch on DOM language with duplicated hard-coded text in `payment.js`.

- [ ] **Step 7: Run focused and full tests**

Run:

```bash
node test/payment-ui.test.js
node test/i18n.test.js
node test/p0-ai-discovery.test.js
npm test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add public/payment.js public/index.html public/zh/index.html public/app-simple.js public/i18n.js public/styles.css test/payment-ui.test.js package.json
git commit -m "feat: add Paddle result paywall"
```

---

### Task 10: Admin Payment APIs, Price Synchronization, and Revenue Summary

**Files:**
- Create: `lib/payment/admin-service.js`
- Modify: `server-simple.js:871-924`
- Create: `test/payment-admin.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces admin HTTP:
  - `GET /api/admin/payments/settings`
  - `PUT /api/admin/payments/settings`
  - `GET /api/admin/payments/summary?from=&to=`
  - `GET /api/admin/payments/orders?...`
  - `GET /api/admin/payments/orders/:id`
  - `POST /api/admin/payments/orders/:id/refund`
- Produces service:
  - `getSettings()`
  - `updateSettings(input, adminSessionHash)`
  - `getSummary(range)`
  - `listOrders(filters)`
  - `getOrderDetail(orderId)`
  - `requestRefund(orderId, reason)`

- [ ] **Step 1: Write failing admin tests**

Assert unauthenticated requests return 401.

For settings update:

```js
await admin.updateSettings({ usdAmountMinor: 299, cnyAmountMinor: 1490 }, "admin-hash");
assert.deepStrictEqual(calls, [
  ["paddle.createPriceVersion", {
    productId: "pro_123",
    previousPriceId: "pri_123",
    usdAmountMinor: 299,
    cnyAmountMinor: 1490,
  }],
  ["repo.updateSettingsAfterPaddleSync", "pri_new", 299, 1490],
]);
```

When Paddle throws, assert local settings and audit success are unchanged and response is 502 with a safe message.

For summary, assert:

- USD and CNY customer gross are separate;
- Paddle payout earnings aggregate in USD;
- refunds/chargebacks reduce adjusted net;
- result includes label `before Payoneer fees and China personal tax`;
- event timeline contains revenue amount for every event.

- [ ] **Step 2: Run tests and verify failure**

Run: `node test/payment-admin.test.js`

Expected: FAIL because admin payment service/routes do not exist.

- [ ] **Step 3: Implement service validation**

Accept only integer ranges:

```js
{
  usdAmountMinor: { min: 50, max: 100000 },
  cnyAmountMinor: { min: 510, max: 1000000 },
  billingEnabled: "boolean",
}
```

The CNY minimum reflects Paddle's published minimum supported CNY charge. Keep current USD 199/CNY 990 as defaults; validation does not change the chosen launch price.

- [ ] **Step 4: Implement Paddle-first setting updates**

Price change transaction:

1. read old settings;
2. create a new Paddle one-time price version under the same product;
3. verify the new price ID, product, currency, amount, non-recurring status, and overrides;
4. write the new active price ID/amounts and audit in one PostgreSQL transaction;
5. never log credentials or full Paddle response.

Enabling billing also checks the environment allow switch and runtime health. Disabling billing stops only new orders/checkouts and does not rewrite existing paid orders, webhook handling, fulfillment, refunds, or cleanup. Keep old price versions active until no unexpired unpaid/pending order references them; archive them later through an audited maintenance action.

- [ ] **Step 5: Implement order/refund routes**

Refund endpoint requires a non-empty reason from:

- `duplicate_charge`;
- `service_not_delivered`;
- `corrupt_result`;
- `legal_requirement`;
- `support_approved`.

It creates a refund request event with zero revenue; actual negative revenue comes from Paddle adjustment webhook.
Enforce one active refund request per order. A rejected adjustment restores `payment_status=paid`; only an approved adjustment creates negative revenue.

All admin mutation routes require the existing admin session, an exact same-origin `Origin` (with `Sec-Fetch-Site` fallback for compatible browsers), and a session-bound CSRF token. Add tests proving cross-site settings/refund requests are rejected.

- [ ] **Step 6: Run focused and full tests**

Run:

```bash
node test/payment-admin.test.js
npm test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add lib/payment/admin-service.js server-simple.js test/payment-admin.test.js package.json
git commit -m "feat: add payment administration APIs"
```

---

### Task 11: Admin Revenue, Orders, Events, and Payment Settings UI

**Files:**
- Create: `public/admin-payments.js`
- Modify: `public/admin.html:69-197`
- Modify: `public/admin.js`
- Modify: `public/styles.css`
- Modify: `test/admin-assets.test.js`
- Modify: `test/admin-navigation.test.js`
- Create: `test/payment-admin-ui.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes Task 10 admin APIs
- Produces payment dashboard sections with stable IDs:
  - `payment-settings`
  - `revenue-overview`
  - `payment-orders`
  - `order-detail`
  - `order-event-timeline`
  - `payment-health`

- [ ] **Step 1: Write UI contract tests**

Assert admin HTML contains:

- billing kill switch;
- USD/CNY price inputs;
- Paddle product/price read-only IDs;
- sync state and last-sync time;
- paid orders, customer gross by currency, tax, Paddle fees, refunds/chargebacks, adjusted USD net;
- explicit `未扣Payoneer提现费及中国个人税费`;
- order filters for date/status/country/currency/source/transaction/order ID;
- order table revenue column;
- event table revenue amount column;
- R2 deletion and webhook health.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node test/payment-admin-ui.test.js
node test/admin-assets.test.js
node test/admin-navigation.test.js
```

Expected: payment UI test fails.

- [ ] **Step 3: Add payment dashboard markup**

Keep analytics as the default admin section. Add a navigation item `订单与收益`; do not create a second password flow.

Use accessible table headers and a confirmation dialog before:

- enabling billing;
- changing prices;
- requesting a refund.

- [ ] **Step 4: Implement safe formatting**

In `admin-payments.js`:

```js
function formatMoney(amountMinor, currency) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
  }).format(Number(amountMinor || 0) / 100);
}
```

Never combine rows with different transaction currencies. Revenue events always format with their own `revenueCurrency`.

Escape all server-provided strings using the same `text()` pattern as `admin.js`.

- [ ] **Step 5: Run focused and full tests**

Run:

```bash
node test/payment-admin-ui.test.js
node test/admin-assets.test.js
node test/admin-navigation.test.js
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add public/admin-payments.js public/admin.html public/admin.js public/styles.css test/payment-admin-ui.test.js test/admin-assets.test.js test/admin-navigation.test.js package.json
git commit -m "feat: show orders and revenue in admin"
```

---

### Task 12: Paid-Service Legal, Privacy, Refund, FAQ, Sitemap, and AI Copy

**Files:**
- Create: `public/refund.html`
- Modify: `public/terms.html`
- Modify: `public/privacy.html`
- Modify: `public/faq.html`
- Modify: `public/zh/faq.html`
- Modify: `public/contact.html`
- Modify: `public/index.html`
- Modify: `public/zh/index.html`
- Modify: `public/sitemap.xml`
- Modify: `public/llms.txt`
- Create: `test/payment-legal.test.js`
- Modify: `test/p0-ai-discovery.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces public routes `/refund`, `/terms`, `/privacy`, `/faq`, `/zh/faq`
- Preserves AI link-only boundary

- [ ] **Step 1: Write legal-content tests**

Assert:

- Terms describes successful-result one-time payment and Paddle as merchant of record;
- Terms contains an operator-name marker sourced from `PUBLIC_OPERATOR_LEGAL_NAME` at serve time or an exact published legal name before live launch;
- Refund Policy covers duplicate charge, non-delivery, corrupt result, mandatory law, and Paddle-managed refunds;
- Privacy names Paddle and Cloudflare R2;
- Privacy says originals do not enter R2;
- Privacy says normal deletion is about one hour and the one-day infrastructure lifecycle fallback may take up to about 24 hours;
- Privacy discloses cross-border processing and a contact path;
- FAQ explains free first success and later pricing;
- footer links Refund, Terms, Privacy, and Contact;
- sitemap includes `/refund`;
- `llms.txt` says AI platforms can recommend the website but cannot compress files or call payment/storage APIs.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node test/payment-legal.test.js
node test/p0-ai-discovery.test.js
```

Expected: legal tests fail because refund and paid-service copy are absent.

- [ ] **Step 3: Implement the public policies**

Use clear English public legal pages. Chinese FAQ summarizes user-facing payment behavior; a full Chinese legal translation is not required for Phase 1 unless needed for Paddle review.

Do not commit the operator's private identity to this plan. Serve `/terms` through the existing HTTP server, read the static HTML, replace a fixed non-secret operator marker in memory with HTML-escaped `PUBLIC_OPERATOR_LEGAL_NAME`, and implement one explicit launch gate:

```text
PUBLIC_OPERATOR_LEGAL_NAME must be configured and rendered in Terms before BILLING_ENABLED may become true in production.
```

`/api/config` must not expose this value.

- [ ] **Step 4: Add consistent footer and discovery links**

Add `/refund` to every public footer that currently links Terms/Privacy and to `sitemap.xml`. Update `llms.txt` without exposing API endpoint recipes.

- [ ] **Step 5: Run focused and full tests**

Run:

```bash
node test/payment-legal.test.js
node test/p0-ai-discovery.test.js
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add public/refund.html public/terms.html public/privacy.html public/faq.html public/zh/faq.html public/contact.html public/index.html public/zh/index.html public/sitemap.xml public/llms.txt test/payment-legal.test.js test/p0-ai-discovery.test.js package.json
git commit -m "docs: publish paid-service policies"
```

---

### Task 13: Runtime Health, Setup Documentation, and Fail-Closed Production Gates

**Files:**
- Modify: `README.md`
- Create: `docs/payment-operations.md`
- Modify: `server-simple.js`
- Modify: `lib/payment/config.js`
- Modify: `test/payment-api.test.js`

**Interfaces:**
- Produces: `GET /api/admin/payments/health`
- Produces: startup checks for DB, Paddle read-only access, price/product match, R2 private object operations, webhook configuration marker, legal operator name

- [ ] **Step 1: Add health-gate tests**

Assert production billing remains false when any condition fails:

- database query;
- Paddle product/price lookup;
- price mismatch;
- R2 put/head/delete probe;
- missing webhook secret;
- missing/inactive notification setting ID or wrong destination/events;
- missing stable `WEB_SESSION_SECRET` or `PAYMENT_IDENTITY_HASH_SECRET`;
- missing legal operator name;
- payout currency not USD.

Assert safe public config returns only:

```js
{
  enabled: false,
  environment: "production",
  usdAmountMinor: 199,
  cnyAmountMinor: 990,
  status: "unavailable"
}
```

No missing secret names should be exposed publicly; they may appear in the authenticated health endpoint.

- [ ] **Step 2: Run tests and verify failure**

Run: `node test/payment-api.test.js`

Expected: health assertions fail.

- [ ] **Step 3: Implement startup and admin health checks**

R2 probe uploads exactly `Buffer.from("1")` under `health/<random>.probe`, verifies size `1`, and deletes it. Never run a public write probe per visitor.

Paddle probe fetches the active product/price from versioned PostgreSQL settings and checks:

- active;
- one-time;
- base amount/currency equal the current DB settings;
- China override amount/currency equal the current DB settings;
- expected IDs.

It also reads `PADDLE_NOTIFICATION_SETTING_ID` and verifies active destination `https://tinypdf.cn/api/paddle/webhook` (or the configured Sandbox/preview origin) subscribes to `transaction.created`, `transaction.completed`, `adjustment.created`, and `adjustment.updated`. Initial env price values are never used to overwrite or validate an already bootstrapped DB row.

- [ ] **Step 4: Write operations documentation**

`docs/payment-operations.md` must include exact dashboard paths and variable names for:

- Railway PostgreSQL private `DATABASE_URL`;
- Paddle sandbox/live API key, client token, product, versioned price, notification setting ID, webhook destination `/api/paddle/webhook`, and the four subscribed events;
- Cloudflare R2 Standard private bucket, account-scoped bucket token, disabled public access, and one-day lifecycle safety rule;
- Payoneer payout setup;
- `PUBLIC_OPERATOR_LEGAL_NAME`;
- sandbox test card paths;
- controlled live transaction;
- price synchronization;
- disabling billing;
- refund handling;
- monthly Paddle reconciliation;
- R2 orphan/deletion checks;
- Railway usage alerts/hard limits;
- secret rotation.
- pre-deploy tag creation, release commit recording, rollback by first setting `BILLING_ENABLED=false`, Railway redeploy of the recorded previous commit, and post-rollback order/R2 reconciliation.

List the minimum Paddle API permissions used: product read, price read/write, transaction read/write, adjustment read/write, and notification-settings read.

Rollback must preserve additive database migrations and all financial rows: stop new checkout, let webhook intake/worker and existing downloads remain online, drain or cancel active checkout attempts, record a database backup point, deploy a payment-aware previous/forward-fix commit, and verify inbox backlog, paid downloads, refunds, and R2 cleanup. Never restore a database backup over newer financial events.

Explicitly instruct the owner never to paste API keys, webhook secrets, identity documents, or R2 secret keys into chat or source control.

- [ ] **Step 5: Update README**

Document:

```bash
npm install
npm test
BILLING_ENABLED=false npm start
```

List required production variables without sample secret values.

- [ ] **Step 6: Run focused and full tests**

Run:

```bash
node test/payment-api.test.js
npm test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/payment-operations.md server-simple.js lib/payment/config.js test/payment-api.test.js
git commit -m "docs: add payment operations and health gates"
```

---

### Task 14: Full Automated Verification and Sandbox Readiness

**Files:**
- Modify: tests only if verification exposes defects
- Create: `test/payment-e2e-fixtures.js` if shared Paddle fixtures are needed
- Modify: `CHANGELOG.md`
- Create: `docs/releases/2026-07-30-payment-phase1.md`

**Interfaces:**
- Verifies the complete Phase 1 implementation

- [ ] **Step 1: Run syntax checks**

Run:

```bash
node --check server-simple.js
for f in lib/payment/*.js public/payment.js public/admin-payments.js; do node --check "$f"; done
```

Expected: no syntax errors.

- [ ] **Step 2: Run the complete test suite**

Run: `npm test`

Expected: every existing and payment test passes.

- [ ] **Step 3: Run targeted security regressions**

Run:

```bash
node test/web-session.test.js
node test/web-access-guard.test.js
node test/payment-api.test.js
node test/payment-webhook.test.js
node test/payment-r2.test.js
```

Expected: all pass; no crawler, wrong-session, replayed webhook, or frontend callback unlocks a result.

- [ ] **Step 4: Run a local billing-disabled smoke test**

Start:

```bash
PORT=3487 HOST=127.0.0.1 BILLING_ENABLED=false npm start
```

Verify:

```bash
curl -fsS http://127.0.0.1:3487/api/config
curl -fsSI http://127.0.0.1:3487/
curl -fsSI http://127.0.0.1:3487/refund
```

Expected:

- public site responds;
- config reports billing disabled;
- no secret values appear;
- current free compression behavior remains available.

- [ ] **Step 5: Run Sandbox integration using real credentials outside source control**

In a secure local/Railway test environment:

1. apply PostgreSQL migration;
2. verify private R2 health probe;
3. verify Paddle product/price USD 1.99 and China CNY 9.90;
4. create one successful compression;
5. confirm first result is free and never enters R2;
6. create a second successful compression;
7. click payment and confirm R2 object exists before checkout;
8. use Paddle sandbox successful card;
9. confirm frontend remains verifying until webhook;
10. confirm one positive revenue event;
11. replay webhook and confirm no duplicate revenue;
12. download through a five-minute URL;
13. force expiration and confirm deletion;
14. issue sandbox refund and confirm negative revenue adjustment.

Expected: all design success criteria hold.

- [ ] **Step 6: Verify admin reconciliation**

Compare one sandbox order:

```text
customer subtotal
tax
customer total
Paddle fee
payout earnings
exchange rate
adjusted payout earnings
```

Expected: TinyPDF matches Paddle exactly and labels payout earnings before Payoneer/China tax.

- [ ] **Step 7: Update changelog**

Add a Phase 1 payment entry covering:

- first free success;
- one-time Paddle checkout;
- R2 temporary paid result;
- admin price/revenue/order reporting;
- refund and file deletion behavior;
- billing disabled until live approval.

Create the release record with:

- previous production commit and new release commit;
- database migration version and backward-compatibility note;
- environment/config changes with no secret values;
- automated and manual verification evidence;
- known risks and monitoring thresholds;
- deploy steps;
- rollback steps that preserve orders and financial records;
- final Sandbox/live enablement status.

- [ ] **Step 8: Commit verification/docs fixes**

```bash
git add CHANGELOG.md docs/releases/2026-07-30-payment-phase1.md test
git commit -m "test: verify Paddle payment validation flow"
```

If no test fixtures or docs changed, do not create an empty commit.

---

### Task 15: Paddle Domain Review Build and Controlled Live Rollout

**Files:**
- No source change unless Paddle review requests a compliant copy correction
- Update: `docs/payment-operations.md` with verified non-secret IDs/status only

**Interfaces:**
- Produces a reviewed live domain and controlled production enablement

- [ ] **Step 1: Deploy with billing disabled**

Deploy the complete code with:

```text
BILLING_ENABLED=false
PADDLE_ENVIRONMENT=production
```

Configure all production secrets directly in Railway. Confirm public paid-service pages render but no real checkout opens.

- [ ] **Step 2: Submit Paddle website approval**

In Paddle live dashboard:

```text
Checkout
→ Website approval / Request domain approval
→ https://tinypdf.cn
```

Confirm Pricing, Terms, Privacy, Refund, product description, support contact, HTTPS, brand, and Paddle-verified legal operator name are publicly reachable.

- [ ] **Step 3: Complete remaining identity/payout checks**

The owner completes Paddle identity verification and Payoneer payout setup personally. Do not copy identity documents or payout credentials into the project.

- [ ] **Step 4: Configure live catalog and webhook**

Confirm:

- live product ID;
- live price ID;
- product tax category `saas` for the online PDF web application;
- USD 1.99 base;
- China CNY 9.90 override;
- automatic location tax mode;
- webhook destination `https://tinypdf.cn/api/paddle/webhook`;
- notification setting active for `transaction.created`, `transaction.completed`, `adjustment.created`, and `adjustment.updated`;
- payout currency USD.

- [ ] **Step 5: Run one controlled real transaction**

Enable billing only for the operator's controlled test window. Compress twice with a fresh browser identity, pay the second order, verify webhook, download, order event revenue, Paddle dashboard totals, and R2 deletion.

If any mismatch occurs, set `BILLING_ENABLED=false` immediately and investigate without deleting the financial record.

- [ ] **Step 6: Reconcile and enable**

Require:

- zero unresolved paid-but-unavailable orders;
- exact transaction/payout reconciliation;
- successful object deletion;
- verified refund path;
- no secret exposure;
- working admin kill switch.

Then enable billing generally.

- [ ] **Step 7: Record rollout status**

Update only non-secret operational status in `docs/payment-operations.md`, such as:

```text
Paddle domain approved: yes
Live webhook verified: yes
Controlled live transaction reconciled: yes
R2 deletion verified: yes
General billing enabled: <date/time>
```

Commit the operational status update.
