# Payment release preflight (2026-10-27)

## Current release decision

**Do not enable billing or deploy the old payment branch.** The deployed email login uses `auth_accounts`/`auth_sessions`, while the old prepaid branch creates a second `email_accounts`/`email_account_sessions` identity and duplicates `/api/auth/*`. A trial merge exposed this semantic conflict even though Git reported only five textual conflicts. It was aborted in the isolated release-prep worktree; production was not changed.

## Verified locally

- Current production-login baseline `npm test`: pass.
- New canonical account-wallet adapter: same verified account resolves to the same wallet; two accounts on a shared browser resolve to different wallets; forged/empty session cannot resolve a wallet; guest and account wallets cannot coincide. The additive mapping schema can be rerun without changing an active login or wallet in the `pg-mem` model. `node --test test/account-wallet.test.js`: 4/4 pass. The adapter is not yet wired to public payment routes.
- A standalone prepaid route handler now derives purchase identity exclusively from the existing signed-in account session, rejects unsupported pack quantities, and keeps purchase history readable when billing is off. Its focused tests pass; it is **not yet mounted in the HTTP server** and does not enable checkout.
- A new additive prepaid schema references the deployed `auth_accounts` rather than preview `email_accounts`. Local `pg-mem` replay applies it twice while preserving an existing auth session, account-wallet binding and purchase row, and rejects a purchase for an unknown account. This is **not** a PostgreSQL migration/restart acceptance test.
- Purchase settlement core now requires an account-bound signed intent and checks `account_wallets` rather than the preview-only `email_accounts`. Local tests cover all four signed pack quantities (1/3/5/10), a three-credit settlement, duplicate settlement, guest isolation, wrong-wallet rejection, unused-bundle refund freeze and partial-use refund refusal. The HTTP route is still standalone; checkout and the runtime are **not** integrated yet.
- Prepaid-only webhook worker now dispatches completed transactions and refund adjustments without the preview's legacy paid-result path. Local fakes cover invalid-signature rejection, duplicate event ID, paid/refund dispatch and an unbound transaction retry. This is **not** a genuine Paddle-signed delivery test.
- Official Paddle Node SDK 3.10.0 is installed behind a fail-closed adapter: sandbox/live API key prefixes must match, webhook verification uses the exact raw body, and refunds request a full adjustment to the original payment method. Adapter tests pass, and `npm audit --omit=dev` reports no production dependency vulnerabilities. This adapter is **not mounted in the server yet** and no real Paddle call has been made.
- A prepaid-only webhook receipt repository now deduplicates event IDs and uses conditional claims with expiring leases and bounded retries. Local `pg-mem` tests cover duplicate storage, claim/complete, delayed retry and lease recovery; a locally HMAC-signed payload also passes the installed Paddle SDK verifier while a tampered body is rejected. This does **not** replace actual signed sandbox delivery or PostgreSQL concurrency testing.
- A prepaid runtime now composes the canonical email auth service, account-wallet adapter, credit ledger, purchases, webhook receiver and worker. Local tests confirm repeat logins map to the same wallet, two emails remain isolated, and disabled billing stays disabled. The runtime is **not yet started from the HTTP server**.
- Old payment preview `npm test`: pass; Playwright preview suite: 25/25 pass. These are simulations, not actual Paddle transactions. The old payment branch now rejects sandbox/live credential prefix mismatches, but this fix remains isolated there.

## Blocking acceptance evidence

No isolated staging `DATABASE_URL` or Paddle sandbox API key, client token and webhook secret are present in the local environment. Therefore no genuine checkout charge, signed webhook, sandbox refund or PostgreSQL migration/restart test has been completed. The Paddle live account-review and website-approval state is also unverified without a screenshot or authenticated dashboard access. Do not substitute the production Neon database or live Paddle credentials for staging.

## Remaining release gates

1. Port wallet/entitlement, checkout and refund modules onto the canonical `auth_accounts` session. Remove the parallel `email_accounts` path from the runtime and make new purchase FKs reference `auth_accounts`. Preserve existing auth sessions and anonymous first-free state.
2. Test four quantities (1, 3, 5, 10), account switching, balance restoration, failed compression, duplicate/late webhooks and partial-use refund refusal in the integrated branch.
3. Apply additive migrations twice on an isolated PostgreSQL database, inspect row counts, restart and verify balances and sessions.
4. Use genuine Paddle sandbox Checkout and notification delivery to verify signed completion, reconciliation, failed payment and refund states; record `txn_`/adjustment IDs in a private QA log without credentials.
5. Confirm live account/domain approval and Alipay eligibility separately. Deploy billing-off first; request explicit authorization before the first live transaction or turning on billing.
