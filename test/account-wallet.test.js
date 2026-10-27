"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { newDb } = require("pg-mem");
const { createEmailAuthService } = require("../lib/auth/service");
const { resolveAccountWallet } = require("../lib/payment/account-wallet");

async function setup() {
  const db = newDb({ noAstCoverageCheck: true });
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
  const one = await resolveAccountWallet({ pool, authService: auth, sessionToken: first.token, guestWalletHash: "guest-a", secret: "wallet-secret" });
  assert.equal(one.accountId, first.account.id);
  assert.notEqual(one.walletHash, "guest-a");
  const again = await resolveAccountWallet({ pool, authService: auth, sessionToken: first.token, guestWalletHash: "guest-b", secret: "rotated-secret" });
  assert.equal(again.walletHash, one.walletHash);
  assert.equal(db.public.many("SELECT * FROM account_wallets").length, 1);
  await pool.end();
});

test("two accounts on the same browser have different wallets and cannot claim an account hash as guest", async () => {
  const { pool, auth, signIn } = await setup();
  const first = await signIn("one@example.com");
  const second = await signIn("two@example.com");
  const a = await resolveAccountWallet({ pool, authService: auth, sessionToken: first.token, guestWalletHash: "shared-guest", secret: "wallet-secret" });
  const b = await resolveAccountWallet({ pool, authService: auth, sessionToken: second.token, guestWalletHash: "shared-guest", secret: "wallet-secret" });
  assert.notEqual(a.walletHash, b.walletHash);
  await assert.rejects(resolveAccountWallet({ pool, authService: auth, sessionToken: first.token, guestWalletHash: a.walletHash, secret: "wallet-secret" }), /guest wallet/i);
  await pool.end();
});

test("invalid or unknown account cannot create a wallet", async () => {
  const { db, pool, auth } = await setup();
  await assert.rejects(resolveAccountWallet({ pool, authService: auth, sessionToken: "forged", guestWalletHash: "guest", secret: "wallet-secret" }), /session/i);
  await assert.rejects(resolveAccountWallet({ pool, authService: auth, sessionToken: "", guestWalletHash: "guest", secret: "wallet-secret" }), /session/i);
  assert.equal(db.public.many("SELECT * FROM account_wallets").length, 0);
  await pool.end();
});

test("rerunning the additive wallet schema preserves sessions and wallet ownership", async () => {
  const { db, pool, auth, signIn } = await setup();
  const login = await signIn("persist@example.com");
  const original = await resolveAccountWallet({ pool, authService: auth, sessionToken: login.token, guestWalletHash: "guest-a", secret: "wallet-secret" });
  const schema = fs.readFileSync(path.join(__dirname, "../lib/payment/account-wallet-schema.sql"), "utf8");
  await pool.query(schema);
  await pool.query(schema);
  assert.equal((await auth.getSession(login.token)).account.id, login.account.id);
  assert.equal((await resolveAccountWallet({ pool, authService: auth, sessionToken: login.token, guestWalletHash: "guest-b", secret: "wallet-secret" })).walletHash, original.walletHash);
  assert.equal(db.public.many("SELECT * FROM account_wallets").length, 1);
  await pool.end();
});
