"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { newDb } = require("pg-mem");
const { createPrepaidRuntime } = require("../lib/payment/prepaid-runtime");

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
