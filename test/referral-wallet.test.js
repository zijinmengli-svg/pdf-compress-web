"use strict";

const assert = require("assert");
const { loadReferralConfig } = require("../lib/referral/config");
const {
  createWalletCookie,
  verifyWalletCookie,
  hashWalletId,
  createInviteCode,
  hashInviteCode,
} = require("../lib/referral/wallet");

const now = new Date("2026-08-08T04:00:00.000Z");
const secret = "referral-test-secret";

function main() {
  const config = loadReferralConfig({ WEB_SESSION_SECRET: secret });
  assert.strictEqual(config.enabled, false);
  assert.strictEqual(config.dailyRewardCap, 50);
  assert.strictEqual(config.rewardPerSide, 1);
  assert.strictEqual(config.rewardExpiryDays, 90);
  assert.strictEqual(config.walletCookieDays, 365);
  assert.strictEqual(config.maxReferralsPerInviter, 20);
  assert.strictEqual(config.timezone, "Asia/Shanghai");
  assert.strictEqual(config.walletSecret, secret);

  const cookie = createWalletCookie({ walletId: "wallet-123", secret, now });
  assert.deepStrictEqual(verifyWalletCookie({ value: cookie, secret, now }), {
    walletId: "wallet-123",
    issuedAt: now.getTime(),
    expiresAt: now.getTime() + 365 * 24 * 60 * 60 * 1000,
  });
  assert.strictEqual(verifyWalletCookie({ value: `${cookie}x`, secret, now }), null);
  assert.strictEqual(verifyWalletCookie({ value: cookie, secret: "wrong", now }), null);
  assert.strictEqual(verifyWalletCookie({ value: cookie, secret, now: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000 + 1) }), null);

  const walletHash = hashWalletId("wallet-123", secret);
  assert.strictEqual(walletHash.length, 64);
  assert.notStrictEqual(walletHash, "wallet-123");

  const inviteCode = createInviteCode();
  assert.ok(/^[A-Za-z0-9_-]+$/.test(inviteCode));
  assert.ok(inviteCode.length >= 20);
  assert.notStrictEqual(inviteCode, createInviteCode());
  assert.strictEqual(hashInviteCode(inviteCode, secret).length, 64);
  console.log("referral wallet tests passed");
}

try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
