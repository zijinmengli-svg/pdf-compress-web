# Payment release preflight (2026-10-27)

## Current release decision

**Do not enable billing or deploy the old payment branch.** The deployed email login uses `auth_accounts`/`auth_sessions`, while the old prepaid branch creates a second `email_accounts`/`email_account_sessions` identity and duplicates `/api/auth/*`. A trial merge exposed this semantic conflict even though Git reported only five textual conflicts. It was aborted in the isolated release-prep worktree; production was not changed.

## Verified locally

- Current production-login baseline `npm test`: pass.
- New canonical account-wallet adapter: same verified account resolves to the same wallet; two accounts on a shared browser resolve to different wallets; forged/empty session cannot resolve a wallet; guest and account wallets cannot coincide. `node --test test/account-wallet.test.js`: 3/3 pass. The adapter is not yet wired to public payment routes.
- Old payment preview `npm test`: pass; Playwright preview suite: 25/25 pass. These are simulations, not actual Paddle transactions. The old payment branch now rejects sandbox/live credential prefix mismatches, but this fix remains isolated there.

## Blocking acceptance evidence

No isolated staging `DATABASE_URL` or Paddle sandbox API key, client token and webhook secret are present in the local environment. Therefore no genuine checkout charge, signed webhook, sandbox refund or PostgreSQL migration/restart test has been completed. Do not substitute the production Neon database or live Paddle credentials for staging.

## Remaining release gates

1. Port wallet/entitlement, checkout and refund modules onto the canonical `auth_accounts` session. Remove the parallel `email_accounts` path from the runtime and make new purchase FKs reference `auth_accounts`. Preserve existing auth sessions and anonymous first-free state.
2. Test four quantities (1, 3, 5, 10), account switching, balance restoration, failed compression, duplicate/late webhooks and partial-use refund refusal in the integrated branch.
3. Apply additive migrations twice on an isolated PostgreSQL database, inspect row counts, restart and verify balances and sessions.
4. Use genuine Paddle sandbox Checkout and notification delivery to verify signed completion, reconciliation, failed payment and refund states; record `txn_`/adjustment IDs in a private QA log without credentials.
5. Confirm live account/domain approval and Alipay eligibility separately. Deploy billing-off first; request explicit authorization before the first live transaction or turning on billing.
