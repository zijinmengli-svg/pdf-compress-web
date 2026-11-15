"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { newDb } = require("pg-mem");
const { createPrepaidRuntime } = require("../lib/payment/prepaid-runtime");
const fs = require("node:fs");

test("runtime connects persistent generic orders to the authenticated TinyPDF adapter", async () => {
  const pool = new (newDb({ noAstCoverageCheck: true }).adapters.createPg().Pool)();
  await pool.query("CREATE TABLE auth_accounts(id uuid PRIMARY KEY,email text NOT NULL)");
  for (const file of ["prepaid-schema.sql", "account-wallet-schema.sql", "payment-schema.sql"]) {
    await pool.query(fs.readFileSync(require.resolve(`../lib/payment/${file}`), "utf8"));
  }
  const id = "00000000-0000-4000-8000-000000000001";
  await pool.query("INSERT INTO auth_accounts(id,email) VALUES ($1,'test@example.com')", [id]);
  const runtime = createPrepaidRuntime({ pool, authService: { getSession: async () => ({ account: { id } }) },
    config: { enabled: false, ready: true, environment: "sandbox", priceId: "pri_test", productId: "pro_test", identityHashSecret: "wallet-secret", webSessionSecret: "intent-secret" },
    paddle: {} });
  const wallet = await runtime.resolveWallet({ sessionToken: "session", guestWalletHash: "guest" });
  const intent = await runtime.orders.prepareCheckout({ productKey: "tinypdf", offerKey: "compression-credit", quantity: 3,
    subject: { namespace: "tinypdf", id, walletHash: wallet.walletHash } });
  assert.match(intent.orderId, /^ord_/);
  assert.equal((await runtime.orders.getOrder({ orderId: intent.orderId, subject: { namespace: "tinypdf", id } })).status, "pending");
  assert.equal(runtime.enabled, false);
  await pool.end();
});

test("prepaid runtime maps the existing email account to one isolated wallet", async () => {
  const db = newDb({ noAstCoverageCheck: true });
  const pool = new (db.adapters.createPg().Pool)();
  await pool.query("CREATE TABLE auth_accounts(id uuid PRIMARY KEY,email text NOT NULL)");
  await pool.query("CREATE TABLE reward_wallets(id uuid PRIMARY KEY,wallet_hash text NOT NULL UNIQUE,created_at timestamptz,updated_at timestamptz)");
  await pool.query("CREATE TABLE account_wallets(account_id uuid PRIMARY KEY REFERENCES auth_accounts(id),wallet_hash text NOT NULL UNIQUE,created_at timestamptz)");
  const a = "00000000-0000-4000-8000-000000000001";
  const b = "00000000-0000-4000-8000-000000000002";
  await pool.query("INSERT INTO auth_accounts(id,email) VALUES ($1,$2),($3,$4)", [a, "a@example.com", b, "b@example.com"]);
  const authService = { getSession: async token => token === "session-a" ? { account: { id: a } } : token === "session-b" ? { account: { id: b } } : null };
  const paddle = { verifyWebhook: async () => ({}), getTransaction: async () => ({}), listRefundAdjustments: async () => [] };
  const runtime = createPrepaidRuntime({ pool, authService, config: {
    enabled: false, ready: true, priceId: "pri_test", productId: "pro_test", identityHashSecret: "wallet-secret", webSessionSecret: "intent-secret",
  }, paddle });
  const first = await runtime.resolveWallet({ sessionToken: "session-a", guestWalletHash: "guest" });
  assert.deepEqual(await runtime.resolveWallet({ sessionToken: "session-a", guestWalletHash: "guest" }), first);
  assert.notEqual((await runtime.resolveWallet({ sessionToken: "session-b", guestWalletHash: "guest" })).walletHash, first.walletHash);
  assert.equal(runtime.enabled, false);
  assert.equal(runtime.purchases.createIntent({ walletHash: first.walletHash, accountId: a, quantity: 1 }).quantity, 1);
  await assert.rejects(runtime.resolveWallet({ sessionToken: "missing", guestWalletHash: "guest" }), /session/i);
  await pool.end();
});
