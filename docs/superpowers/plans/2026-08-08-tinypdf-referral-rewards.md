# TinyPDF Referral Rewards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with a review checkpoint after each task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a no-login referral system that grants the inviter and the referred friend one free PDF compression each after the friend completes their first successful compression download, while preserving the existing payment flow.

**Architecture:** Add a Neon-backed reward wallet and credit ledger independent of the two-hour web session and independent of Paddle/R2 availability. Use an opaque referral code for first-touch attribution, a transactional service for credit consumption and reward settlement, and admin-controlled settings for the feature flag and Beijing-time daily cap. Keep the existing Node HTTP server, static frontend, Ghostscript worker, and `pg`/`pg-mem` stack; do not add a runtime dependency.

**Tech Stack:** Node.js >=20, native `http` server, PostgreSQL/Neon through `pg`, `pg-mem` tests, existing Ghostscript worker, static HTML/CSS/JavaScript.

## Global Constraints

- Default language remains English; Chinese is available at `/zh/` and uses the same behavior.
- Desktop is the primary experience; mobile receives basic responsive adaptation only.
- Referral reward is one credit for the inviter and one additional credit for the friend; the friend’s first free compression is separate and does not consume the referral credit.
- A reward is settled only after the friend’s first successful compression result is generated and an authorized download request is received.
- First-touch attribution is locked to the first opened invitation link.
- Each reward grant expires individually after 90 days; the wallet cookie lasts 365 days.
- One inviter can receive rewards for at most 20 valid friends.
- The default global cap is 50 valid friends per Beijing calendar day; cap overflow does not roll over and does not block normal first-free compression.
- The cap is an admin setting, accepts 0–500, and setting 0 pauses rewards without disabling compression.
- Suspicious referrals lose the reward only; normal compression and the base free credit remain available.
- The feature is deployed disabled and enabled manually after verification.
- Existing `free_grants`, orders, revenue data, Paddle webhooks, AI link-only behavior, and compression limits remain backward compatible.
- Do not store balance, raw Cookie values, raw IPs, file contents, or personal data in referral URLs or client-controlled storage.
- Existing upload and job protections remain: 100 MB upload limit, two in-flight upload buffers, and five active jobs.

---

## File Map

Create focused referral modules instead of adding all business rules to `server-simple.js`:

- Create `db/migrations/002_referral_rewards.sql` — wallet, attribution, ledger, settings, counters, and audit tables.
- Create `lib/referral/config.js` — validated defaults and environment-secret loading.
- Create `lib/referral/wallet.js` — signed wallet cookie, wallet hash, and opaque invite-code primitives.
- Create `lib/referral/repository.js` — PostgreSQL queries and transactional repository methods.
- Create `lib/referral/credit-service.js` — credit consumption, FIFO expiry, and balance calculations.
- Create `lib/referral/service.js` — attribution, first-download settlement, cap/risk decisions, and public/admin projections.
- Create `test/referral-repository.test.js` — migration, constraints, and transactional repository tests with `pg-mem`.
- Create `test/referral-wallet.test.js` — cookie/code security and expiry tests.
- Create `test/referral-service.test.js` — business-rule tests with fake repository/transaction boundaries.
- Create `test/referral-http.test.js` — HTTP-level happy path and idempotency tests with a temporary server and test database adapter.
- Create `test/referral-admin.test.js` — admin setting validation and summary projection tests.
- Modify `db/migrations/001_payment_schema.sql` only if the migration runner needs a compatibility index; do not rewrite historical tables.
- Modify `lib/payment/database.js` only to expose the shared migration/transaction helper if the implementation needs it.
- Modify `lib/payment/order-service.js` — consume the new credit service inside the existing successful-compression transaction instead of the binary `free_grants` check.
- Modify `server-simple.js` — initialize shared database/referral runtime, attach wallet/attribution, expose API routes, settle rewards on download requests, and export a dependency-injectable `createServer({ dataRuntime, paymentRuntime })` for HTTP tests.
- Modify `public/index.html` and `public/zh/index.html` — add the referral status/share panel.
- Modify `public/app-simple.js`, `public/i18n.js`, and `public/styles.css` — fetch status, copy/share links, update after download, and localize the UI.
- Modify `public/admin.html`, `public/admin.js`, and `public/styles.css` — add referral metrics, event table, settings, and audit feedback.
- Modify `lib/analytics.js` only for stable labels/funnel fields used by the admin page; referral truth comes from the referral tables.
- Modify `package.json` — include the new tests in the existing test command.
- Modify `CHANGELOG.md` and `docs/payment-deployment.md` — document migration, feature flag, settings, and rollback.

## Task 1: Add the reward schema and repository boundary

**Files:**
- Create: `db/migrations/002_referral_rewards.sql`
- Create: `lib/referral/repository.js`
- Create: `test/referral-repository.test.js`
- Modify: `package.json`

**Interfaces:**

- `createReferralRepository({ pool, now = () => new Date(), timezone = "Asia/Shanghai" })` returns:
  - `getSettings(db)` and `updateSettings({ enabled, dailyRewardCap }, db)`
  - `ensureWallet({ walletHash, legacyIdentityHash, now }, db)`
  - `ensureInviteCode({ walletId, codeHash, now }, db)`
  - `lockFirstTouch({ inviteCodeHash, inviteeWalletId, now }, db)`
  - `getWalletStatus({ walletHash, now }, db)`
  - `consumeCredit({ walletId, jobId, idempotencyKey, now }, db)`
  - `settleReferral({ inviteeWalletId, jobId, downloadTokenId, risk, now }, db)`
  - `getAdminSummary({ from, to, now }, db)`
  - `listAdminEvents({ limit, status }, db)`
  - `migrateLegacyFreeGrants(db)`

- `settleReferral` must return one of `{ status: "rewarded", inviterWalletId, inviteeWalletId }`, `{ status: "cap_reached" }`, `{ status: "blocked", reason }`, or `{ status: "already_settled" }`.

- Tables must include `reward_wallets`, `referrals`, `reward_ledger`, `reward_ledger_events`, `referral_settings`, `referral_daily_counters`, and `referral_audit_log`. Use unique constraints for wallet hash, invite-code hash, invitee first-touch attribution, successful-download idempotency, and ledger event idempotency.

- `referral_settings` must be seeded with `enabled = false`, `daily_reward_cap = 50`, `reward_per_side = 1`, `reward_expiry_days = 90`, `wallet_cookie_days = 365`, `max_referrals_per_inviter = 20`, and `timezone = 'Asia/Shanghai'`.

- `referral_daily_counters` must store a Beijing-local calendar date and an atomically incremented `valid_friend_count`; a transaction must lock the date row before comparing and incrementing the cap.

- `migrateLegacyFreeGrants` preserves the existing semantics: a missing `free_grants` row means the welcome grant is still unused and cannot be enumerated, `restored_at IS NOT NULL` means one available welcome grant, and an un-restored row means no available welcome grant. `ensureWallet({ walletHash, legacyIdentityHash })` lazily creates the welcome grant using an idempotent source key derived from the current web-session identity; restored rows are migrated by keyed source and repeated startup cannot create duplicates.

- [ ] **Step 1: Write failing repository tests**

Add `pg-mem` cases for:

```js
const { pool, repo } = await makeRepository();
const settings = await repo.getSettings(pool);
assert.strictEqual(settings.daily_reward_cap, 50);
const wallet = await repo.ensureWallet({ walletHash: "wallet-a" }, pool);
const invite = await repo.ensureInviteCode({ walletId: wallet.id, codeHash: "code-a" }, pool);
const attribution = await repo.lockFirstTouch({ inviteCodeHash: "code-a", inviteeWalletId: "wallet-b" }, pool);
assert.strictEqual(attribution.inviter_wallet_id, wallet.id);
const second = await repo.lockFirstTouch({ inviteCodeHash: "code-other", inviteeWalletId: "wallet-b" }, pool);
assert.strictEqual(second.inviter_wallet_id, wallet.id);
```

Also cover: FIFO consumption, expired grants, duplicate idempotency keys, 20-invite limit, daily cap locking, migration of restored and consumed `free_grants`, lazy welcome creation keyed by legacy identity, and repeated migration.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node test/referral-repository.test.js`  
Expected: FAIL because the migration and repository methods do not exist.

- [ ] **Step 3: Implement the migration and repository**

Use the existing migration runner’s filename ordering. Keep all monetary/payment tables unchanged. For every credit mutation, insert a `reward_ledger_events` row with a unique `idempotency_key`; never update a historical event.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node test/referral-repository.test.js`  
Expected: PASS, including a second migration run with no duplicate schema errors.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/002_referral_rewards.sql lib/referral/repository.js test/referral-repository.test.js package.json
git commit -m "feat: add referral reward ledger schema"
```

## Task 2: Implement wallet and invite-code primitives

**Files:**
- Create: `lib/referral/config.js`
- Create: `lib/referral/wallet.js`
- Create: `test/referral-wallet.test.js`

**Interfaces:**

```js
loadReferralConfig(env = process.env) // -> { enabled, dailyRewardCap, rewardPerSide, rewardExpiryDays, walletCookieDays, maxReferralsPerInviter, timezone, walletSecret }
createWalletCookie({ walletId, secret, now }) // -> signed cookie value
verifyWalletCookie({ value, secret, now }) // -> { walletId, issuedAt, expiresAt } | null
hashWalletId(walletId, secret) // -> 64-char keyed hash
createInviteCode() // -> opaque URL-safe code
hashInviteCode(code, secret) // -> 64-char keyed hash
```

- The cookie payload contains only a random wallet ID, issued timestamp, and expiry; sign it with HMAC-SHA256.
- `REFERRAL_WALLET_SECRET` is preferred; fall back to `WEB_SESSION_SECRET` only when the former is absent, and keep the feature disabled if neither is present.
- Reject malformed, expired, or tampered cookies without throwing from the request path.
- Invite codes must be at least 128 bits of entropy and must not encode a wallet ID or balance.

- [ ] **Step 1: Write failing security tests**

Test round-trip verification, tampering, expiry at exactly 365 days, invalid secret, invite-code uniqueness, URL-safe characters, and keyed hashes that do not reveal raw IDs.

- [ ] **Step 2: Run `node test/referral-wallet.test.js` and verify failure**

- [ ] **Step 3: Implement config validation and primitives**

Use the same input-validation style as `lib/payment/config.js`; clamp the admin-configurable cap only at repository/admin boundaries, not in the cookie module.

- [ ] **Step 4: Run the focused test and verify PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/referral/config.js lib/referral/wallet.js test/referral-wallet.test.js
git commit -m "feat: add referral wallet security primitives"
```

## Task 3: Add credit consumption and referral settlement services

**Files:**
- Create: `lib/referral/credit-service.js`
- Create: `lib/referral/service.js`
- Create: `test/referral-service.test.js`

**Interfaces:**

```js
createCreditService({ repo, pool, now = () => new Date() })
consumeForCompression({ walletHash, jobId, now }, db) // -> { granted, source, remaining, expiresAt }
getBalance({ walletHash, now }, db) // -> { available, grants: [{ source, remaining, expiresAt }] }

createReferralService({ repo, creditService, config, now = () => new Date() })
captureAttribution({ inviteCode, inviteeWalletHash, now }, db) // -> { status, referralId }
settleFirstDownload({ inviteeWalletHash, jobId, downloadTokenId, signals, now }, db) // -> settled result from Task 1
getPublicStatus({ walletHash, origin, language, now }, db) // -> { enabled, balance, shareUrl, rewardPerSide, expiresInDays }
getAdminData({ from, to, limit, status }, db) // -> { settings, summary, events }
updateAdminSettings({ enabled, dailyRewardCap, adminSessionHash, now }, db) // -> { settings, audit }
```

Business rules:

- `consumeForCompression` consumes one earliest-expiring active credit only after a valid compression result exists; it is idempotent by `(walletHash, jobId)`.
- If no credit remains, return `granted: false` so the existing Paddle order path can require payment when billing is enabled.
- `settleFirstDownload` first rejects already-settled invitees, self-referrals, inviter cap overflow, suspicious risk, and daily cap overflow. A cap overflow must not create either bonus grant.
- A successful settlement inserts two grants of one credit each, both with `expires_at = now + 90 days`, and two `granted` events in one transaction.
- Lowering the cap does not revoke grants already issued; raising it applies to the current Beijing date immediately.
- `getPublicStatus` never returns wallet IDs, hashes, risk signals, or raw storage identifiers.

- [ ] **Step 1: Write failing service tests**

Cover: first welcome credit, FIFO consumption, no credit after expiry, first-touch locking, one-time settlement, self-referral, 20-referral limit, 50-per-day cap, cap 0, suspicious reward-only block, repeated download idempotency, and admin setting audit records.

- [ ] **Step 2: Run `node test/referral-service.test.js` and verify failure**

- [ ] **Step 3: Implement both services against repository interfaces**

Keep all SQL in the repository; services should make decisions and compose transactions rather than issue ad-hoc queries.

- [ ] **Step 4: Run the focused test and verify PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/referral/credit-service.js lib/referral/service.js test/referral-service.test.js
git commit -m "feat: implement referral credit and settlement rules"
```

## Task 4: Wire the shared database runtime and compression/payment flow

**Files:**
- Modify: `server-simple.js`
- Modify: `lib/payment/order-service.js`
- Modify: `lib/payment/database.js` only if a shared transaction helper is required
- Create: `test/referral-http.test.js`

**Interfaces:**

- Add `startDataRuntime()` in `server-simple.js` that creates one `pg` pool from `DATABASE_URL`, runs all migrations, creates the referral repository/services, and exposes `dataRuntime.referrals`, `dataRuntime.credits`, and `dataRuntime.pool`.
- Make `startPaymentRuntime(dataRuntime)` reuse the shared pool and migrations. Payment remains unavailable when Paddle/R2 variables are missing, but referral credits still work whenever `DATABASE_URL` and the wallet secret exist.
- Change `createOrderService` to accept `creditService` and call `consumeForCompression({ walletHash, jobId })` inside the existing order transaction. Return `creditSource` and `remainingCredits` to the job state.

- [ ] **Step 1: Write failing HTTP/integration tests**

Use the planned dependency-injectable `createServer({ dataRuntime, paymentRuntime })` so the test can provide a `pg-mem` referral runtime without requiring a live Neon database. The test server must verify:

1. A real browser session receives a wallet cookie on `/`.
2. `?ref=<code>` locks first-touch attribution and later codes do not replace it.
3. `/api/referral/status` returns a share URL and balance without exposing identifiers.
4. A successful job download settles both one-credit grants exactly once.
5. A second download does not settle again.
6. A failed compression, no download, cap overflow, and suspicious signal do not grant rewards.
7. Existing `/api/config`, `/api/jobs`, and payment-disabled behavior remain 200/expected.

- [ ] **Step 2: Run `node test/referral-http.test.js` and verify failure**

- [ ] **Step 3: Initialize the shared runtime**

Start the data runtime before payment setup. If no `DATABASE_URL` exists, leave referrals disabled and preserve current file-backed analytics/free compression behavior; do not crash the site. Export `createServer({ dataRuntime, paymentRuntime })` for tests while keeping the existing `main()` startup path unchanged.

- [ ] **Step 4: Attach wallet and attribution to page requests**

On real browser navigation to `/` or `/zh/`, set `tinypdf_reward_wallet` only when missing/invalid. Read `ref` from the query string, validate length/characters, hash it, and call `captureAttribution` without changing the visible URL. Do not assign attribution for automated users.

- [ ] **Step 5: Add public referral routes**

Add:

```text
GET /api/referral/status  -> current balance, nearest expiry, share URL, enabled state
POST /api/referral/track  -> optional share-click analytics only; never grants credit
```

Both routes require a valid website session and signed wallet cookie. `GET /api/config` adds only public referral flags/reward copy; it does not return the balance or wallet hash.

- [ ] **Step 6: Attach wallet context to jobs and settle on download**

Store only `walletHash` and a boolean `freeCreditConsumed` in the in-memory job. On `/api/jobs/:id/download`, after access/payment checks and before streaming, call `settleFirstDownload` with the job ID and one-time download request ID. Settlement errors must be logged and must not turn a valid download into a 500 response.

- [ ] **Step 7: Run the integration test and verify PASS**

Run: `node test/referral-http.test.js`  
Expected: all referral and existing compression/payment assertions pass.

- [ ] **Step 8: Commit**

```bash
git add server-simple.js lib/payment/order-service.js lib/payment/database.js test/referral-http.test.js
git commit -m "feat: wire referral credits into compression downloads"
```

## Task 5: Add the desktop-first share and balance UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/zh/index.html`
- Modify: `public/app-simple.js`
- Modify: `public/i18n.js`
- Modify: `public/styles.css`
- Create: `test/referral-frontend.test.js`

**Interfaces:**

- Add a small `#referral-panel` near the compression action with `#referral-balance`, `#referral-expiry`, `#copy-referral-link`, and `#share-referral-link`.
- `app-simple.js` adds `loadReferralStatus()`, `copyReferralLink()`, `shareReferralLink()`, and `refreshReferralStatus()`.
- Use `navigator.share` when available; otherwise copy the opaque link and show a confirmation. Share/copy never changes the balance.

- [ ] **Step 1: Write static frontend tests**

Assert both language pages include the panel IDs, the default English strings explain “invite a friend”, the Chinese translator has equivalent keys, and `app-simple.js` calls `/api/referral/status` and does not award locally.

- [ ] **Step 2: Run `node test/referral-frontend.test.js` and verify failure**

- [ ] **Step 3: Add localized markup and strings**

Keep English default. Chinese text must be present only on `/zh/`; do not add a mobile-specific feature flow.

- [ ] **Step 4: Implement status, copy, and system-share behavior**

Show the panel only when the server reports the feature enabled. Refresh the displayed balance after a successful download and after page load. Handle clipboard/share rejection with a non-blocking message.

- [ ] **Step 5: Add desktop responsive styles and run the static test**

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/zh/index.html public/app-simple.js public/i18n.js public/styles.css test/referral-frontend.test.js
git commit -m "feat: add referral sharing UI"
```

## Task 6: Add admin settings, metrics, events, and audit display

**Files:**
- Modify: `server-simple.js`
- Modify: `public/admin.html`
- Modify: `public/admin.js`
- Modify: `public/styles.css`
- Create: `test/referral-admin.test.js`

**Interfaces:**

Add protected admin endpoints:

```text
GET  /api/admin/referrals
POST /api/admin/referrals/settings
GET  /api/admin/referrals/events?limit=100&status=<status>
```

All writes require the existing admin cookie, same-origin validation, and an `adminSessionHash` audit value. Settings payload validation must reject non-integers, values outside 0–500, invalid booleans, and malformed timezone values; timezone remains fixed to `Asia/Shanghai` in this release.

- [ ] **Step 1: Write failing admin tests**

Cover unauthenticated 401/403 responses, default settings, cap update and audit row, cap 0, rejection of 501, summary counts, status filters, and absence of raw wallet/IP values.

- [ ] **Step 2: Run `node test/referral-admin.test.js` and verify failure**

- [ ] **Step 3: Add protected routes and repository projections**

Merge the referral payload into `/api/admin/summary` only under a `referral` key so existing analytics consumers remain compatible.

- [ ] **Step 4: Add admin controls and tables**

Display today’s valid friends, cap, remaining quota, reward count, funnel, blocked/cap-reached counts, conversion rate, setting state, and event rows. Show a warning above 100 and a confirmation before setting 0 or changing the cap downward.

- [ ] **Step 5: Run the focused test and verify PASS**

- [ ] **Step 6: Commit**

```bash
git add server-simple.js public/admin.html public/admin.js public/styles.css test/referral-admin.test.js
git commit -m "feat: add referral admin controls and reporting"
```

## Task 7: Migrate legacy free grants, analytics labels, and documentation

**Files:**
- Modify: `lib/analytics.js`
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/payment-deployment.md`
- Modify: `README.md` if deployment variables are documented there

- [ ] **Step 1: Add migration/analytics regression tests**

Verify restored legacy `free_grants` rows become exactly one welcome credit, un-restored rows remain consumed, new wallets receive exactly one lazy welcome credit, the migration is idempotent, referral events appear in admin summaries, and historical payment/revenue summaries are byte-for-byte unchanged for the same fixtures.

- [ ] **Step 2: Run the regression tests and verify failure**

- [ ] **Step 3: Add stable event labels**

Use explicit events: `referral_link_opened`, `referral_compression_started`, `referral_first_download`, `referral_reward_granted`, `referral_reward_blocked`, `referral_cap_reached`, `referral_credit_spent`, and `referral_credit_expired`. Keep anonymous IDs and counters only.

- [ ] **Step 4: Document operational settings and rollback**

Document `REFERRAL_WALLET_SECRET`, database migration behavior, default-disabled rollout, Beijing reset, 50-person cap, 90-day grants, 365-day wallet, same-browser limitation, and the “disable rewards without disabling compression” rollback.

- [ ] **Step 5: Add all new tests to `npm test` and run them**

Run: `npm test`  
Expected: existing payment, compression, analytics, admin, and all referral tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/analytics.js package.json CHANGELOG.md docs/payment-deployment.md README.md test
git commit -m "docs: document referral rollout and compatibility"
```

## Task 8: Release verification and controlled enablement

**Files:**
- Modify: `CHANGELOG.md` with the release commit and rollback note
- No production code changes unless a verification failure requires a focused fix

- [ ] **Step 1: Run static and unit verification**

Run:

```bash
git diff --check
npm test
```

Expected: no whitespace errors and all tests pass.

- [ ] **Step 2: Run a local feature-off smoke test**

Start with `REFERRAL_ENABLED=false` (or no wallet secret), verify `/`, `/zh/`, `/api/config`, `/api/jobs`, `/admin`, and the existing payment-unavailable response remain healthy.

- [ ] **Step 3: Run a local feature-on smoke test**

Use a test `DATABASE_URL`/`pg-mem` adapter and wallet secret; exercise two invite codes, first-touch locking, successful download settlement, repeat download, cap 0, cap 50, expiry, and admin update.

- [ ] **Step 4: Record release evidence**

Record migration version, test command output, feature flag state, default cap 50, and rollback command (admin switch to disabled) in `CHANGELOG.md`.

- [ ] **Step 5: Commit the verified release notes**

```bash
git add CHANGELOG.md
git commit -m "chore: record referral rollout verification"
```

## Verification Checklist

Before enabling the feature in production, confirm all of the following:

- `002_referral_rewards.sql` is recorded once in `payment_schema_migrations`.
- Existing free-grant count before and after migration is reconciled.
- `REFERRAL_WALLET_SECRET` is set and not printed in logs.
- `referral_enabled` is false during the first deploy.
- Admin cap is 50 and timezone is Asia/Shanghai.
- A friend’s first successful download produces exactly two one-credit grants, one per wallet.
- Repeated download and page refresh produce no duplicate grants or ledger events.
- Cap overflow records `cap_reached` while still allowing the friend’s base free compression.
- Suspicious referrals remain compressible but receive no bonus.
- Payment-disabled and payment-enabled paths both behave correctly.
- No new route exposes wallet IDs, hashes, raw IPs, balances writable by the client, or compression API access to automated callers.
