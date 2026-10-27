"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { newDb } = require("pg-mem");
const { createEmailAuthService } = require("../lib/auth/service");
const { resolveAccountWallet } = require("../lib/payment/account-wallet");
const { createCreditPurchaseService } = require("../lib/payment/credit-purchase");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

async function setup() {
  const db = newDb();
  const pool = new (db.adapters.createPg().Pool)();
  let code;
  const auth = createEmailAuthService({ pool, secret: "auth-secret", sendCode: async (_email, sent) => { code = sent; } });
  await auth.ready();
  await pool.query("CREATE TABLE reward_wallets(id uuid PRIMARY KEY,wallet_hash text UNIQUE NOT NULL,created_at timestamptz,updated_at timestamptz)");
  await pool.query(fs.readFileSync(path.join(__dirname, "../lib/payment/account-wallet-schema.sql"), "utf8"));
  await pool.query(`CREATE TABLE credit_purchases(transaction_id text PRIMARY KEY,wallet_hash text NOT NULL,account_id uuid REFERENCES auth_accounts(id),paddle_price_id text,paddle_product_id text,quantity integer,customer_amount_minor integer,customer_currency text,status text,refund_adjustment_id text,created_at timestamptz,updated_at timestamptz)`);
  await pool.query("CREATE TABLE reward_ledger(id uuid PRIMARY KEY,wallet_id uuid,source_key text UNIQUE,remaining_amount integer,status text,updated_at timestamptz)");
  await pool.query("CREATE TABLE reward_ledger_events(id uuid PRIMARY KEY,wallet_id uuid,ledger_id uuid,event_type text,amount integer,idempotency_key text UNIQUE,metadata jsonb,created_at timestamptz)");
  await auth.requestCode({ email: "buyer@example.com", ip: "192.0.2.1" });
  const login = await auth.verifyCode({ email: "buyer@example.com", code });
  const wallet = await resolveAccountWallet({ pool, authService: auth, sessionToken: login.token, guestWalletHash: "guest-wallet", secret: "wallet-secret" });
  const repo = {
    ensureWallet: async ({ walletHash }, tx) => (await tx.query("SELECT id FROM reward_wallets WHERE wallet_hash=$1", [walletHash])).rows[0],
    grantPurchasedCredit: async ({ walletId, transactionId, quantity }, tx) => {
      await tx.query("INSERT INTO reward_ledger(id,wallet_id,source_key,remaining_amount,status,updated_at) VALUES ($1,$2,$3,$4,'active',$5) ON CONFLICT(source_key) DO NOTHING", [crypto.randomUUID(), walletId, `purchase:${transactionId}`, quantity, new Date()]);
    },
  };
  const purchases = createCreditPurchaseService({ pool, referralRepo: repo, intentSecret: "intent-secret", getSettings: () => ({ paddle_price_id: "pri_test", paddle_product_id: "pro_test" }) });
  return { pool, login, wallet, purchases };
}

test("purchase intent requires a signed-in account, and settlement binds to its wallet", async () => {
  const { pool, login, wallet, purchases } = await setup();
  assert.throws(() => purchases.createIntent({ walletHash: wallet.walletHash }), /account/i);
  const intent = purchases.createIntent({ walletHash: wallet.walletHash, accountId: login.account.id, quantity: 3 });
  const remote = { id: "txn_canonical_1", status: "completed", customData: { tinypdfCreditIntent: intent.token },
    items: [{ quantity: 3, price: { id: "pri_test", productId: "pro_test" } }],
    details: { totals: { total: "2970", currencyCode: "CNY" } } };
  assert.equal((await purchases.settleCompleted(remote)).granted, true);
  assert.equal((await purchases.settleCompleted(remote)).granted, false);
  assert.equal((await purchases.getPurchaseStatus({ walletHash: wallet.walletHash, transactionId: remote.id })).status, "completed");
  assert.equal((await purchases.getPurchaseStatus({ walletHash: "guest-wallet", transactionId: remote.id })).status, "not_found");
  const rows = (await pool.query("SELECT account_id,quantity FROM credit_purchases WHERE transaction_id=$1", [remote.id])).rows;
  assert.equal(rows[0].account_id, login.account.id);
  assert.equal(Number(rows[0].quantity), 3);
  await pool.end();
});

test("signed intent cannot credit another account or guest wallet", async () => {
  const { pool, login, wallet, purchases } = await setup();
  const intent = purchases.createIntent({ walletHash: "guest-wallet", accountId: login.account.id });
  const remote = { id: "txn_wrong_wallet", status: "completed", customData: { tinypdfCreditIntent: intent.token },
    items: [{ quantity: 1, price: { id: "pri_test", productId: "pro_test" } }],
    details: { totals: { total: "990", currencyCode: "CNY" } } };
  await assert.rejects(purchases.settleCompleted(remote), /binding/i);
  assert.equal((await purchases.getPurchaseStatus({ walletHash: wallet.walletHash, transactionId: remote.id })).status, "not_found");
  await pool.end();
});

test("refund freezes an entirely unused bundle and refuses a partially used bundle", async () => {
  const { pool, login, wallet, purchases } = await setup();
  async function paid(id) {
    const intent = purchases.createIntent({ walletHash: wallet.walletHash, accountId: login.account.id, quantity: 3 });
    return { id, status: "completed", customData: { tinypdfCreditIntent: intent.token },
      items: [{ quantity: 3, price: { id: "pri_test", productId: "pro_test" } }],
      details: { totals: { total: "2970", currencyCode: "CNY" } } };
  }
  const unused = await paid("txn_unused_bundle");
  await purchases.settleCompleted(unused);
  let submissions = 0;
  const paddle = { getTransaction: async id => id === unused.id ? unused : partial,
    listRefundAdjustments: async () => [],
    requestFullRefund: async ({ transactionId }) => { submissions++; return { id: "adj_test", transactionId, action: "refund", type: "full", status: "pending_approval" }; } };
  assert.equal((await purchases.requestRefund({ transactionId: unused.id, reason: "other", paddle })).status, "refund_pending");
  assert.equal((await purchases.getAdminPurchase(unused.id)).creditRemaining, 0);
  await assert.rejects(purchases.requestRefund({ transactionId: unused.id, reason: "other", paddle }), /already/i);
  const partial = await paid("txn_partial_bundle");
  await purchases.settleCompleted(partial);
  await pool.query("UPDATE reward_ledger SET remaining_amount=2 WHERE source_key=$1", [`purchase:${partial.id}`]);
  await assert.rejects(purchases.requestRefund({ transactionId: partial.id, reason: "other", paddle }), /already used/i);
  assert.equal(submissions, 1);
  await pool.end();
});
