# TinyPDF Payment Release Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect prepaid compression credits and Paddle checkout to the already deployed email identity without enabling live billing prematurely.

**Architecture:** Keep `lib/auth/service.js` and its `auth_accounts` session as canonical. Port payment, wallet, purchase and refund services behind an account-wallet adapter, then run against an isolated PostgreSQL staging database and Paddle sandbox before any production deployment.

**Tech Stack:** Node.js HTTP server, PostgreSQL, Paddle Node SDK/Paddle.js, Playwright, node:test.

**Spec:** `docs/superpowers/specs/2026-10-27-payment-release-integration-design.md`

## Global Constraints

- `BILLING_ENABLED=false` until sandbox acceptance and explicit live launch approval.
- Keep existing `/api/auth/*` routes, `auth_accounts`, `auth_sessions`, and current account UI working.
- Four packs: 1, 3, 5, 10; base per-credit price ¥9.90 in China and $1.99 elsewhere, no pack discount.
- Do not delete existing account, order, payment, ledger, or webhook data.
- Sandbox and live credentials and database must be separate.

## Review Focus

- Existing login session across deployment resolves to the same account and does not mint extra free credit.
- Two emails on one browser never access each other's purchased balance or orders.
- Failed/late/duplicate signed Paddle events grant or revoke at most once.
- Checkout quantity edit cannot grant more credits than paid for or credit a different account.
- Partially used pack cannot be auto-refunded; refund pending/rejected is not labeled refunded.

---

### Task 1: Canonical identity and wallet mapping

**Files:** `lib/auth/service.js`, new `lib/payment/account-wallet.js`, new additive SQL migration, account/credit HTTP tests.

**Interfaces:** `resolveAccountWallet({ pool, accountId, guestWalletHash, secret }) -> { accountId, walletHash }`; only a validated `auth_sessions` account ID may call it.

- [ ] Write tests for existing account session, new account, shared device, repeat login, and invalid account ID; run and observe failure.
- [ ] Add non-destructive account-wallet migration and adapter; keep verified account ID immutable.
- [ ] Replace payment preview's parallel auth endpoints/table usage with canonical identity in payment routes and purchase history.
- [ ] Run focused tests, then the complete `npm test` suite.

### Task 2: Checkout, entitlements, refund and UI integration

**Files:** `server-simple.js`, `lib/payment/*`, `lib/referral/*`, `public/buy.*`, `public/account.*`, `public/credits-ui.js`, `public/index.html`, `public/zh/index.html`, relevant tests.

**Interfaces:** GET balance, POST purchase intent, GET purchase status/history, signed Paddle webhook, admin refund by `txn_` ID; all derive account from the canonical HttpOnly session.

- [ ] Add failing tests for free exhaustion, four quantities, verified ownership, duplicate event, failed compression, full-unused refund, partial-use refusal, account switching, and language/UI preservation.
- [ ] Port payment modules and routes in small groups, avoiding old `/api/auth/*` and account-login scripts.
- [ ] Keep current login UI; connect buy/account pages to the existing login state and update pricing copy.
- [ ] Run `npm test`, browser E2E, compression/download check, and `git diff --check`.

### Task 3: Isolated PostgreSQL and Paddle sandbox acceptance

**Files:** `docs/prepaid-deployment.md`, deployment configuration, test fixtures/scripts only if required by failed acceptance.

**Interfaces:** Staging `DATABASE_URL`; sandbox Paddle API key/token/product/price/notification secret. Never print secrets or place them in the repository.

- [ ] Apply migrations twice to a staging PostgreSQL database; verify row counts and existing auth sessions remain intact; restart service and restore balance.
- [ ] Configure sandbox checkout and a notification destination on a staging/tunnel URL; verify signed `transaction.completed` and adjustment callbacks.
- [ ] Complete sandbox payment for 1/3/5/10, failure card, duplicate/reordered Webhook, delayed reconciliation, full-unused refund, partial-use refusal, and rejected/refund-pending simulation.
- [ ] Record transaction IDs, local account IDs (redacted), final balances and Paddle adjustment statuses in a QA report; reconcile every paid transaction.

### Task 4: Closed production deployment and release gate

**Files:** deployment notes and the tested release commit only.

- [ ] Confirm Paddle account/domain approval and Alipay status from the live dashboard; do not infer from sandbox.
- [ ] Deploy with `BILLING_ENABLED=false`; verify login, anonymous free compression, and payment endpoints remain closed.
- [ ] Obtain explicit approval for first live transaction and for turning on billing; keep rollback path and refund processing active.
