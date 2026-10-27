"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { newDb } = require("pg-mem");
const { createEmailAuthService } = require("../lib/auth/service");
const { resolveAccountWallet } = require("../lib/payment/account-wallet");

async function setup() {
  const db = newDb();
  const pool = new (db.adapters.createPg().Pool)();
  const codes = [];
  const auth = createEmailAuthService({ pool, secret: "auth-test-secret", sendCode: async (email, code) => codes.push({ email, code }) });
  await auth.ready();
  await pool.query("CREATE TABLE reward_wallets (id uuid PRIMARY KEY, wallet_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL)");
  await pool.query(fs.readFileSync(path.join(__dirname, "../lib/payment/account-wallet-schema.sql"), "utf8"));
  async function signIn(email) {
    await auth.requestCode({ email, ip: "192.0.2.1" });
    return auth.verifyCode({ email, code: codes.at(-1).code });
  }
  return { db, pool, auth, signIn };
}

test("verified account keeps one wallet across sessions without claiming the guest wallet", async () => {
  const { db, pool, auth, signIn } = await setup();
  const first = await signIn("one@example.com");
  const one = await resolveAccountWallet({ pool, accountId: (await auth.getSession(first.token)).account.id, guestWalletHash: "guest-a", secret: "wallet-secret" });
  assert.equal(one.accountId, first.account.id);
  assert.notEqual(one.walletHash, "guest-a");
  const again = await resolveAccountWallet({ pool, accountId: first.account.id, guestWalletHash: "guest-b", secret: "rotated-secret" });
  assert.equal(again.walletHash, one.walletHash);
  assert.equal(db.public.many("SELECT * FROM account_wallets").length, 1);
  await pool.end();
});

test("two accounts on the same browser have different wallets and cannot claim an account hash as guest", async () => {
  const { pool, signIn } = await setup();
  const first = await signIn("one@example.com");
  const second = await signIn("two@example.com");
  const a = await resolveAccountWallet({ pool, accountId: first.account.id, guestWalletHash: "shared-guest", secret: "wallet-secret" });
  const b = await resolveAccountWallet({ pool, accountId: second.account.id, guestWalletHash: "shared-guest", secret: "wallet-secret" });
  assert.notEqual(a.walletHash, b.walletHash);
  await assert.rejects(resolveAccountWallet({ pool, accountId: first.account.id, guestWalletHash: a.walletHash, secret: "wallet-secret" }), /guest wallet/i);
  await pool.end();
});

test("invalid or unknown account cannot create a wallet", async () => {
  const { db, pool } = await setup();
  await assert.rejects(resolveAccountWallet({ pool, accountId: "not-an-id", guestWalletHash: "guest", secret: "wallet-secret" }), /account/i);
  await assert.rejects(resolveAccountWallet({ pool, accountId: "00000000-0000-4000-8000-000000000001", guestWalletHash: "guest", secret: "wallet-secret" }), /account/i);
  assert.equal(db.public.many("SELECT * FROM account_wallets").length, 0);
  await pool.end();
});
