# TinyPDF Paddle Single-Payment Validation Design

Date: 2026-07-29

## Goal

Validate whether TinyPDF users will pay for a successfully compressed PDF without introducing accounts, credit packs, subscriptions, or browser-side compression.

The first paid version keeps the existing server-side Ghostscript workflow and adds a result-gated one-time payment:

- the first successful compression for an anonymous browser is free;
- later successful compressions require a one-time payment before download;
- China mainland price: CNY 9.90;
- overseas base price: USD 1.99;
- prices remain editable in the TinyPDF admin and synchronize to Paddle;
- payment is authoritative only after a verified Paddle webhook;
- AI products may recommend and link to TinyPDF but cannot invoke compression or payment APIs outside the website.

This is the Phase 1 payment-validation release. The account and credit-pack system remains a later Phase 2 project.

## Confirmed Product Constraints

- Default public language remains English.
- Chinese remains available only after the user selects the Chinese entry.
- The maintained product is desktop-first.
- Mobile receives basic responsive layout only; there is no separate mobile flow or mobile-specific feature design.
- Compression remains on the server using the current Ghostscript pipeline.
- Browser-local compression is not introduced.
- Users pay only after a usable compression result exists.
- TinyPDF does not expose a public compression API, agent tool, MCP tool, or unattended checkout interface.
- Paddle is the merchant of record and Payoneer is the planned payout destination.
- The owner has created both Paddle live and sandbox accounts as an individual/sole trader.
- Paddle live domain approval is postponed until the paid UI and legal pages are ready.

## Selected Architecture

The paid flow adds four bounded subsystems to the existing native Node application:

1. **Payment service**
   - Creates server-side Paddle transactions.
   - Verifies Paddle webhook signatures.
   - Treats `transaction.completed` as the only payment-unlock event.
   - Synchronizes admin price changes to Paddle.

2. **Order and revenue store**
   - Uses PostgreSQL hosted in the existing Railway project.
   - Persists orders, payment state, revenue totals, webhook receipts, free-grant use, and file deletion state.
   - Uses Railway private networking for the database connection.

3. **Private result storage**
   - Uses Cloudflare R2 Standard storage through its S3-compatible API.
   - Stores only compressed results for users who click the payment button.
   - Never stores the original upload in R2.
   - Keeps the bucket private and issues short-lived signed download URLs.

4. **Admin payment and revenue UI**
   - Extends the existing TinyPDF admin rather than creating a second admin product.
   - Adds price configuration, Paddle sync status, order history, order events, revenue totals, refunds, chargebacks, and storage-cleanup health.

The integration must be split into focused modules rather than adding all payment, storage, and database logic directly to `server-simple.js`. The native Node server remains the entry point and delegates to those modules.

## External Services

### Paddle

Paddle handles:

- checkout and payment methods;
- customer-side sales tax and VAT;
- buyer receipts and first-line payment support;
- fraud and chargeback processing;
- transaction, adjustment, and payout totals.

TinyPDF handles:

- creating the compression result;
- deciding whether payment is required;
- creating and binding a transaction to an order;
- fulfilling the download only after verified payment;
- product support and compression-result support.

### Payoneer

Payoneer is only a Paddle payout destination. Phase 1 does not call a Payoneer API and does not try to calculate a per-order bank deposit.

Admin revenue labels must explicitly state:

> Paddle net earnings, before Payoneer withdrawal fees and any China personal income tax.

### Cloudflare R2

Use R2 Standard only. Do not enable Infrequent Access, public bucket access, R2 Data Catalog, or a Cloudflare Worker for the Phase 1 download path.

### Railway PostgreSQL

PostgreSQL is required because paid orders, idempotent webhooks, price audit history, and revenue adjustments cannot safely use the existing local JSONL analytics file or in-memory job map.

## Pricing Model

Create one Paddle product and one non-recurring price:

- product: `TinyPDF Single PDF Compression`;
- billing type: one-time;
- base unit price: USD 1.99;
- country-specific override for China: CNY 9.90;
- tax mode: automatic based on customer location.

The price displayed by TinyPDF is an offer preview. Paddle checkout is the source of truth for the buyer's final total, including applicable location-based tax.

The public Paddle rate is currently 5% plus USD 0.50 per checkout transaction, but products below USD 10 may receive custom pricing. TinyPDF must not hard-code an expected Paddle fee. Actual fee, tax, earnings, payout exchange rate, and adjusted totals come from Paddle transaction data.

## Admin Price Configuration

Add a payment settings section to the existing admin with:

- billing enabled/disabled;
- overseas base price in USD;
- China price in CNY;
- Paddle product ID;
- Paddle price ID;
- current tax mode;
- last successful Paddle synchronization time;
- last synchronization result;
- current live/sandbox environment indicator;
- price-change audit history.

Saving a price follows this order:

1. Validate the requested values locally.
2. Send the price and China override update to Paddle.
3. Verify the Paddle response.
4. Only after Paddle succeeds, commit the new local configuration.
5. If Paddle fails, preserve the old local and Paddle-facing price and show the error.

Existing orders retain their original price snapshot. A later price change affects only newly created transactions.

`billing_enabled` defaults to false in a new environment. It cannot be enabled unless database, Paddle credentials, webhook configuration, product/price IDs, and R2 health checks all pass.

Every payment-setting mutation creates an audit record with:

- admin session identifier;
- old values;
- new values;
- Paddle request result;
- timestamp.

Secrets are never included in audit records.

## Anonymous First-Free Rule

The first successful compression is free per server-issued anonymous browser identity.

Implementation rules:

- use the existing signed, HttpOnly TinyPDF web-session cookie as the anonymous identity;
- store only a keyed hash of that identity in PostgreSQL;
- consume the free grant only after server-side compression succeeds;
- a failed or canceled compression does not consume the grant;
- a server fulfillment failure may restore the grant;
- clearing cookies or changing browsers may yield another free result;
- do not introduce invasive fingerprinting solely to prevent repeated free use;
- rate limits remain the protection against automated abuse.

This is a conversion experiment, not a fraud-proof entitlement system. Strong cross-device enforcement requires Phase 2 accounts.

## End-to-End User Flow

### Compression

1. The browser uploads a PDF to the existing TinyPDF endpoint.
2. The server validates the file and target size.
3. Ghostscript produces the result in Railway temporary storage.
4. If compression fails, the user sees the existing error path and no order or payment prompt is created.
5. If compression succeeds, delete the original upload as soon as the result is finalized.
6. Create an order with immutable size, price, locale, source-attribution, and free-eligibility snapshots.

### First successful result

If the anonymous identity still has its free grant:

1. Atomically consume the free grant.
2. Mark the order `payment_status=not_required`.
3. Keep the result in Railway temporary storage.
4. Allow download for one hour after compression completion.
5. Do not upload the free result to R2.

### Later successful results

If payment is required:

1. Show achieved size, reduction percentage, target status, price, and payment call to action.
2. Do not expose the download endpoint.
3. Keep the compressed result in Railway temporary storage for up to one hour while the user decides.

### Payment-button action

When the user selects `Pay and download`:

1. Authenticate the request with the signed web session and order capability token.
2. Confirm that the order is unpaid and that the local compressed result still exists.
3. Rate-limit payment-storage preparation.
4. Upload only the compressed result to the private R2 bucket.
5. Verify object size and checksum with R2.
6. Record the object key and expiration in PostgreSQL.
7. Delete the local compressed copy after the R2 write is confirmed.
8. Create a Paddle transaction server-side using the configured price.
9. Bind `order_id` and a non-secret job reference in Paddle `custom_data`.
10. Return only the transaction/checkout information needed to open Paddle Overlay Checkout.

If R2 preparation or Paddle transaction creation fails, do not open checkout and do not charge the user.

### Checkout and payment confirmation

- Paddle Overlay Checkout opens on the TinyPDF page.
- Paddle localizes checkout language and available payment methods.
- The frontend checkout-success callback is presentational only.
- The result remains locked while the backend waits for payment confirmation.
- The UI polls an authenticated order-status endpoint and displays `Verifying payment`.
- Only a verified `transaction.completed` webhook changes `payment_status` to `paid`.

The webhook handler must verify:

- Paddle signature;
- unique Paddle event ID;
- event type;
- Paddle transaction status;
- expected product and price IDs;
- bound TinyPDF order ID;
- amount and currency consistency;
- that the order is not already fulfilled or reversed.

For defense in depth, the backend may retrieve the transaction from Paddle before fulfillment when the webhook payload is incomplete or inconsistent.

### Download

After verified payment:

1. Reset the paid result expiration to one hour after `transaction.completed`.
2. Set `fulfillment_status=available`.
3. Allow the authenticated browser to request a signed R2 download URL.
4. Generate a URL valid for approximately five minutes.
5. Allow a new signed URL to be generated during the one-hour order window so interrupted downloads can retry.
6. Never expose a permanent public R2 URL.

The original filename is not part of the R2 key or R2 object metadata. A friendly download filename may be generated at response time from current client state, but it is not persisted in the payment database or storage key.

## File Retention and Deletion

### Normal retention

- Original upload: Railway temporary storage only; delete immediately after compression finalization or failure cleanup.
- Free compressed result: Railway temporary storage; delete about one hour after compression completion.
- Paid-flow result before checkout completion: private R2; delete about one hour after checkout preparation if unpaid.
- Paid result: private R2; delete about one hour after `transaction.completed`.

Opening checkout may extend an unpaid hold long enough to cover the active payment window, with a hard maximum of two hours before payment.

### Cleanup implementation

PostgreSQL records:

- storage provider;
- random object key;
- object size and checksum;
- stored time;
- expected expiration;
- deletion state;
- deletion attempts;
- last deletion error;
- confirmed deletion time.

An application cleanup worker runs periodically and deletes expired objects. `DeleteObject` success is persisted. Failed deletion retries use bounded backoff.

Configure an R2 one-day lifecycle rule only as a safety fallback. R2 lifecycle deletion is not the one-hour enforcement mechanism and may take additional time to complete. Legal copy must state the normal one-hour deletion target and the longer safety-cleanup window that may apply during an infrastructure failure.

### Missing file after payment

If Paddle confirms payment but the object is missing or corrupt:

1. Do not claim successful fulfillment.
2. Mark the order `fulfillment_status=failed`.
3. Create a full-refund request through Paddle using an idempotency key.
4. Record the refund request and later adjustment webhook.
5. Tell the user that payment succeeded but delivery failed and a refund was initiated.

## Data Model

All money values use integer minor units and an explicit ISO currency code. Floating-point money is prohibited.

### `payment_settings`

Singleton live configuration:

- environment;
- billing enabled;
- Paddle product and price IDs;
- USD amount;
- CNY China override amount;
- tax mode;
- last sync status and timestamps;
- version.

### `payment_setting_audits`

Append-only price and configuration audit entries.

### `free_grants`

- anonymous identity hash;
- consumed order ID;
- consumed time;
- restored time and reason, if applicable.

A unique constraint makes free-grant consumption atomic.

### `orders`

Core fields:

- internal UUID;
- opaque public order token hash;
- compression job reference;
- anonymous identity hash;
- created/compressed/paid/downloaded/expired timestamps;
- payment status: `not_required`, `unpaid`, `pending`, `paid`, `refund_pending`, `refunded`, `chargeback`;
- fulfillment status: `compressed`, `storing`, `stored`, `available`, `expired`, `failed`;
- Paddle transaction/customer/price/product identifiers;
- original, target, and result byte counts;
- reached-target flag;
- country and language snapshot;
- original price and currency snapshot;
- source attribution snapshot.

Do not store PDF contents in PostgreSQL.

### `order_financials`

Authoritative Paddle financial snapshot:

- customer subtotal, discount, tax, and total in transaction currency;
- Paddle fee in transaction currency;
- transaction earnings;
- payout currency;
- payout subtotal, tax, fee, earnings, and exchange rate;
- adjusted payout totals after refunds or chargebacks;
- last reconciled time.

### `order_events`

Append-only order timeline. Every row includes:

- order ID;
- event type;
- source: browser, compression server, Paddle webhook, admin, cleanup worker;
- provider event ID where applicable;
- occurred and recorded times;
- payment and fulfillment status snapshots;
- customer amount and currency snapshot;
- `revenue_delta_minor`;
- `revenue_currency`;
- safe metadata without PDF content or secrets.

Every event has a revenue delta:

- non-financial events: zero;
- `transaction.completed`: positive Paddle payout earnings;
- refund or chargeback: negative difference between previously recognized and adjusted payout earnings;
- reversal or correction: signed delta that makes the timeline reconcile.

The revenue currency is the Paddle payout currency, configured as USD, so event deltas can be summed safely. Customer CNY and USD totals remain separate fields and are never added together.

### `webhook_receipts`

Idempotency and audit fields:

- unique Paddle event ID;
- event type;
- transaction or adjustment ID;
- payload hash;
- receive/process timestamps;
- processing result;
- error code and safe error detail.

Do not retain the full webhook payload by default because it may contain customer personal data. Persist only the fields needed for reconciliation and support.

### `file_objects`

- order ID;
- provider and bucket identifier;
- random object key;
- size and checksum;
- stored/expires/deleted timestamps;
- deletion status and retry fields.

## Source Attribution

Each order snapshots the acquisition data already available to TinyPDF so payment conversion can be compared with traffic sources.

Special rule for the owner's personal website:

- exact referrer host `libindesign.cn` or `www.libindesign.cn` is classified as `libindesign.cn`;
- explicit matching UTM values may also classify it as the personal-site source;
- empty, unknown, typed, bookmarked, or stripped referrers remain `direct/unknown`;
- never label arbitrary direct traffic as the personal website.

AI referrals retain their specific AI/search source where detectable. Crawlers are excluded from buyer conversion metrics and cannot create an order without a real compression job.

## Admin Revenue Dashboard

Add summary cards for the selected date range:

- paid orders;
- customer gross paid, grouped by transaction currency;
- sales tax, grouped by transaction currency;
- Paddle fees;
- Paddle net earnings in USD;
- refunds and chargebacks in USD;
- adjusted Paddle net earnings in USD;
- paid-to-download conversion;
- average order value by currency;
- payment-processing and fulfillment failures.

Do not display a fabricated `bank received` value. Payoneer withdrawal fees and China personal tax are outside the transaction data and cannot be known per order.

Add order filters:

- date range;
- payment status;
- fulfillment status;
- country;
- transaction currency;
- payment method where Paddle provides it;
- traffic source, including AI referrals and exact `libindesign.cn`;
- Paddle transaction ID;
- TinyPDF order ID.

Each order detail shows:

- price snapshot;
- customer subtotal, tax, and total;
- Paddle fee and net earnings;
- payout exchange rate and payout earnings;
- result availability/deletion state;
- download state;
- chronological event timeline;
- revenue amount on every event.

Paddle `details.payout_totals` and adjusted totals are authoritative. Estimated fees calculated from the public rate may appear only before completion and must be labeled as estimates; they are replaced by actual values after the completed webhook.

## Payment, Refund, and Revenue Events

Minimum supported events:

- order created;
- compression succeeded;
- free grant consumed;
- payment required;
- R2 upload started/succeeded/failed;
- checkout transaction created;
- checkout opened/canceled;
- Paddle transaction paid/completed;
- payment verification failed;
- download URL issued;
- download started;
- result expired/deleted;
- refund requested/approved/rejected/completed;
- chargeback created/reversed;
- price changed/synchronized.

Refunds and chargebacks never rewrite historical positive events. They append negative revenue events and update adjusted totals.

## Refund Policy

Add a dedicated `/refund` page and link it from the footer, checkout-support copy, and Terms.

Phase 1 refund principles:

- no payment is requested when compression fails;
- duplicate charges are refunded;
- a paid result that cannot be delivered is fully refunded;
- a corrupt or unusable delivered file is eligible for support and appropriate refund;
- refunds required by applicable consumer law or Paddle policy remain available;
- the user does not receive a direct off-platform refund from TinyPDF; refunds are processed through Paddle.

The policy must not promise that every successfully delivered digital result is unconditionally non-refundable where mandatory consumer law says otherwise.

## Legal and Public Copy

Before Paddle domain approval:

- update homepage and result UI with USD 1.99 and CNY 9.90 pricing;
- explain the first-successful-compression free rule;
- explain that later payment happens only after successful compression;
- update Terms from a free-tool description to the paid result-gated service;
- add the dedicated Refund Policy;
- update Privacy Policy for Paddle, PostgreSQL order data, temporary Cloudflare R2 storage, cross-border processing, retention, signed links, and user rights;
- show a support contact;
- include the Paddle-verified operator legal name in the public Terms.

The operator's legal name is intentionally not recorded in this repository design document. Before live domain review, the published Terms must use the exact name verified by Paddle.

## Security Boundaries

- Paddle API key and webhook secret are server-only.
- R2 write credentials are server-only and restricted to the single TinyPDF bucket.
- Paddle client-side token is the only Paddle credential allowed in public frontend code.
- Secrets live in Railway environment variables, never source control or analytics.
- Admin endpoints require the existing authenticated admin session.
- Order endpoints require both the signed web session and an opaque order capability token.
- Download authorization is checked by TinyPDF before issuing a signed R2 URL.
- Signed URLs expire in about five minutes.
- R2 public access and `r2.dev` public access remain disabled.
- Object keys are random and contain no filenames, emails, IP addresses, or Paddle customer data.
- Webhook signatures are verified against the exact raw request body.
- Webhook event IDs and transaction IDs are protected by unique constraints.
- All state changes are transactional and idempotent.
- Client events never unlock a file or create recognized revenue.

Required environment values:

- `DATABASE_URL`;
- `PADDLE_ENVIRONMENT`;
- `PADDLE_API_KEY`;
- `PADDLE_CLIENT_TOKEN`;
- `PADDLE_WEBHOOK_SECRET`;
- `PADDLE_PRODUCT_ID`;
- `PADDLE_PRICE_ID`;
- `R2_ACCOUNT_ID`;
- `R2_ACCESS_KEY_ID`;
- `R2_SECRET_ACCESS_KEY`;
- `R2_BUCKET`;
- `R2_ENDPOINT`.

## Abuse and Cost Controls

Only a real, successful, session-bound compression job can prepare R2 storage or create a Paddle transaction.

Controls:

- reuse existing upload and compression concurrency limits;
- add per-IP-prefix and per-session rate limits for uploads, R2 preparation, and transaction creation;
- allow only one active Paddle transaction per order;
- allow only one R2 object per order;
- use a CAPTCHA only for suspicious or high-rate behavior;
- reject known crawler and bot attempts before compression/order endpoints;
- track abandoned R2-prepared orders;
- monitor object count, R2 write volume, Railway outbound GB, and cleanup backlog;
- configure Railway billing alerts and a safe hard limit;
- keep `billing_enabled` as an emergency kill switch.

With an average 20 MB paid result, Railway-to-R2 egress is approximately USD 0.001 per prepared checkout at the current USD 0.05/GB Railway rate. R2 Standard is expected to remain within its current free storage and operation allowances at early-stage volume, but billing must be monitored rather than assumed permanently free.

## Failure Handling

### Compression failure

- no order payment prompt;
- no R2 upload;
- no Paddle transaction;
- no free-grant consumption.

### Result expires before payment

- block checkout creation;
- show `Result expired—compress the file again`;
- never charge against an expired result.

### R2 upload or verification failure

- keep payment closed;
- retry safely when possible;
- record a zero-revenue failure event.

### Checkout canceled or payment failed

- keep the order unpaid;
- allow another checkout attempt while the result exists;
- never unlock based on the frontend callback.

### Webhook delayed

- show `Verifying payment`;
- poll backend order state;
- do not download until `transaction.completed`.

### Duplicate or out-of-order webhooks

- unique event receipt makes processing idempotent;
- recompute state from authoritative Paddle totals;
- do not duplicate recognized revenue or free a second file.

### Database unavailable

- fail closed for new paid checkouts;
- continue public informational pages;
- do not accept money that cannot be recorded and fulfilled.

### R2 unavailable after payment

- preserve the paid order and retry signed-link issuance;
- extend availability when an infrastructure outage prevents download;
- if the object is missing or corrupt rather than temporarily unavailable, initiate the full-refund path.

### Price synchronization failure

- retain the previous active price;
- show an actionable admin error;
- do not partially update local configuration.

### Refund or chargeback

- append negative revenue events;
- use Paddle adjusted payout totals;
- revoke future download-link issuance when appropriate;
- never delete the original completed-payment event.

## Testing Strategy

### Unit tests

- integer money and currency handling;
- first-free grant atomicity;
- order payment/fulfillment state transitions;
- event revenue deltas;
- source attribution, including exact `libindesign.cn` matching;
- price validation and Paddle-first configuration commit;
- signed capability-token validation;
- object-key generation without filename leakage;
- expiration and cleanup selection;
- webhook signature and idempotency logic.

### Integration tests

- PostgreSQL migrations and uniqueness constraints;
- server-created Paddle transaction binding;
- completed webhook creates exactly one positive revenue event;
- duplicate completed webhook changes nothing;
- refund and chargeback create correct negative deltas;
- existing order retains its price after an admin price change;
- R2 upload verification occurs before checkout creation;
- expired or missing files cannot create checkout;
- signed download URL cannot be requested before payment;
- paid file can issue replacement signed URLs during its availability window;
- cleanup deletes the object and persists deletion state.

### Paddle Sandbox end-to-end tests

- card success;
- card decline;
- user cancellation;
- delayed webhook;
- duplicate webhook replay;
- applicable tax preview;
- China CNY override;
- USD base price;
- refund adjustment;
- frontend success spoofing does not unlock.

When Paddle sandbox supports the relevant local methods, test WeChat Pay/Alipay behavior; otherwise verify those methods during a controlled live checkout after Paddle approval.

### Regression tests

All existing compression, analytics, admin-auth, AI-discovery, and traffic-deduplication tests must continue to pass.

The payment work must not change:

- Ghostscript output behavior;
- target-size evaluation;
- English-default routing;
- basic mobile adaptation;
- crawler-readable public content;
- the rule that AI systems cannot directly invoke compression.

## Rollout

1. Add database and storage abstractions behind disabled billing.
2. Add schema migrations, Paddle sandbox integration, R2 private bucket, and cleanup worker.
3. Add result gating and admin payment/revenue UI.
4. Update legal and pricing pages.
5. Run automated tests and Paddle sandbox end-to-end tests.
6. Publish the non-charging legal/pricing-ready version if needed for Paddle domain review.
7. Submit `tinypdf.cn` for Paddle live domain approval and complete identity verification.
8. Configure live credentials and verify a controlled real transaction.
9. Enable billing for a small traffic slice or short observation window.
10. Reconcile TinyPDF revenue against Paddle dashboard and payout totals.
11. Enable billing generally only after successful reconciliation and file-deletion verification.

Turning billing off returns the site to free download behavior for new orders. Existing paid orders remain downloadable until their recorded expiration and retain their financial history.

## Observability and Reconciliation

Admin health indicators:

- Paddle webhook last success and failure;
- webhook processing latency;
- unprocessed webhook count;
- orders paid but not available;
- R2 upload failure rate;
- expired objects waiting for deletion;
- object deletion retry count;
- price sync status;
- Paddle-vs-TinyPDF revenue reconciliation difference.

Monthly reconciliation uses Paddle payout reports and transaction payout totals. Customer totals, taxes, Paddle fees, FX effects, refunds, chargebacks, and net payout contributions remain separately visible.

## Resource and Cost Impact

New resources:

- Railway PostgreSQL service;
- Cloudflare R2 account and private bucket;
- Paddle live and sandbox configuration;
- Payoneer payout setup;
- operational monitoring and monthly reconciliation.

Potential costs:

- Railway PostgreSQL compute/storage;
- Railway outbound traffic when uploading a paid result to R2;
- R2 storage and operations above free allowances;
- Paddle transaction fees and transaction-currency conversion;
- Payoneer withdrawal and possible annual account fees;
- refunds, chargebacks, and retained fees;
- compliance/accounting support where required.

The admin records Paddle earnings, not the final China bank deposit.

## Risks and Mitigations

### Paddle individual-seller or domain rejection

Keep billing disabled and the existing free service operational. Complete public pricing, product description, Terms, Privacy, Refund Policy, HTTPS, and support information before domain submission.

### Low-price transaction economics

Keep prices configurable, request Paddle sub-USD-10 pricing, and evaluate paid conversion before building credit packs. Do not expand Phase 1 into a bundle system.

### Cross-border PDF handling

Minimize scope: originals never enter R2, compressed results are private and short-lived, filenames are absent from object keys, processing is disclosed, and the operator reviews applicable data-protection obligations before live launch.

### Credential compromise

Use least-privilege bucket tokens, environment secrets, rotation procedures, disabled public access, and short signed URLs.

### Bot-driven cost

Upload to R2 only after a real user selects payment for a successful session-bound result. Apply rate limits, anomaly monitoring, and billing limits.

### Infrastructure restart

PostgreSQL and R2 hold paid state and results independently of Railway process memory. Local temporary files remain acceptable only before payment.

### Incorrect financial reporting

Use Paddle payout totals and adjustment totals, integer minor units, one payout currency for revenue deltas, append-only events, and reconciliation checks.

## Out of Scope

- user registration or login;
- account balance or credit packs;
- subscription billing;
- stored payment methods;
- invoices outside Paddle;
- browser-local PDF compression;
- native Alipay or WeChat merchant integration;
- mobile-specific product workflows;
- AI or third-party direct compression access;
- email-based result delivery;
- long-term PDF storage;
- storing PDF contents in PostgreSQL;
- calculating China personal income tax;
- calculating exact Payoneer bank receipts per order;
- replacing the current analytics system beyond adding order attribution.

## Success Criteria

- A failed compression can never open checkout or consume the free grant.
- The first successful compression for an anonymous browser downloads without payment.
- Later successful results remain locked until a verified Paddle `transaction.completed` webhook.
- A forged or replayed frontend event cannot unlock a result or create revenue.
- USD 1.99 and CNY 9.90 are used for new orders and remain editable through the admin with Paddle-first synchronization.
- Existing orders retain their price snapshots after price changes.
- Only payment-intent results enter R2; originals and free results do not.
- Paid results survive Railway process restarts and remain available for the recorded window.
- Expired R2 objects are deleted and deletion state is auditable.
- Every order event exposes a positive, zero, or negative USD revenue delta; non-financial events use zero.
- Refunds and chargebacks reduce adjusted revenue without erasing payment history.
- Admin revenue reconciles with Paddle transaction and payout totals.
- `libindesign.cn` is recognized only from exact referrer/UTM evidence, never from arbitrary direct traffic.
- Public pages remain English by default, Chinese remains click-selected, and mobile remains basic adaptation only.
- AI crawlers may index and recommend TinyPDF but cannot call compression or payment capabilities.

## Official References

- Paddle account verification: https://www.paddle.com/help/start/account-verification/what-is-account-verification
- Paddle domain review: https://www.paddle.com/help/start/account-verification/what-is-domain-verification
- Paddle pricing: https://www.paddle.com/pricing
- Paddle transaction totals: https://developer.paddle.com/api-reference/transactions/overview
- Paddle completed webhooks: https://developer.paddle.com/webhooks/transactions/transaction-completed
- Paddle payout timing: https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare R2 security: https://developers.cloudflare.com/r2/reference/data-security/
- Cloudflare R2 lifecycle behavior: https://developers.cloudflare.com/r2/buckets/object-lifecycles/
- Railway pricing: https://docs.railway.com/pricing
- China personal-information protection law: https://www.npc.gov.cn/npc/c2/c30834/202108/t20210820_313088.html
