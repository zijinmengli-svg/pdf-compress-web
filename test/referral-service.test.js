"use strict";

const assert = require("assert");
const { createCreditService } = require("../lib/referral/credit-service");
const { createReferralService } = require("../lib/referral/service");

function fakeRepository() {
  const wallets = new Map();
  const codes = new Map();
  const calls = [];
  const settings = {
    enabled: true,
    daily_reward_cap: 50,
    reward_per_side: 1,
    reward_expiry_days: 90,
    wallet_cookie_days: 365,
    max_referrals_per_inviter: 20,
    timezone: "Asia/Shanghai",
  };
  return {
    calls,
    settings,
    async getSettings() { return settings; },
    async ensureWallet({ walletHash }) {
      if (!wallets.has(walletHash)) wallets.set(walletHash, { id: `id-${walletHash}`, wallet_hash: walletHash });
      return wallets.get(walletHash);
    },
    async ensureInviteCode({ walletId, codeHash }) {
      const existing = [...codes.values()].find((item) => item.wallet_id === walletId);
      if (existing) return existing;
      const row = { id: `code-${walletId}`, wallet_id: walletId, code_hash: codeHash };
      codes.set(codeHash, row);
      return row;
    },
    async lockFirstTouch({ inviteCodeHash, inviteeWalletId }) {
      calls.push(["attribution", inviteCodeHash, inviteeWalletId]);
      return { id: "ref-1", inviter_wallet_id: "id-inviter", invitee_wallet_id: inviteeWalletId, status: "opened" };
    },
    async ensureWelcomeCredit(input) { calls.push(["welcome", input]); return { granted: true }; },
    async getWalletStatus() { return { available: 2, grants: [{ grant_type: "welcome", remaining_amount: 2, expires_at: "2026-11-06T00:00:00.000Z" }] }; },
    async consumeCredit(input) { calls.push(["consume", input]); return { granted: true, source: "welcome", remaining: 1 }; },
    async settleReferral(input) { calls.push(["settle", input]); return { status: "rewarded", inviterWalletId: "id-inviter", inviteeWalletId: "id-invitee" }; },
    async getAdminSummary() { return { rewarded: 1, rewardCredits: 2, dailyCap: 50, dailyUsed: 1, dailyRemaining: 49 }; },
    async listAdminEvents() { return []; },
    async updateSettings(input) { calls.push(["settings", input]); Object.assign(settings, { enabled: input.enabled, daily_reward_cap: input.dailyRewardCap }); return settings; },
  };
}

async function main() {
  const repo = fakeRepository();
  const now = new Date("2026-08-08T04:00:00.000Z");
  const creditService = createCreditService({ repo, pool: {}, now: () => now });
  const referralService = createReferralService({ repo, creditService, secret: "service-secret", origin: "https://tinypdf.cn", now: () => now });

  const consumed = await creditService.consumeForCompression({ walletHash: "wallet-a", legacyIdentityHash: "legacy-a", jobId: "job-1" });
  assert.strictEqual(consumed.granted, true);
  assert.strictEqual(repo.calls[0][0], "welcome");
  assert.strictEqual(repo.calls[1][0], "consume");

  const status = await referralService.getPublicStatus({ walletHash: "wallet-a", legacyIdentityHash: "legacy-a", language: "en" });
  assert.strictEqual(status.enabled, true);
  assert.strictEqual(status.balance, 2);
  assert.match(status.shareUrl, /^https:\/\/tinypdf\.cn\/?\?ref=/);
  assert.doesNotMatch(JSON.stringify(status), /wallet-a|id-wallet/);

  const attribution = await referralService.captureAttribution({ inviteCode: "abc", inviteeWalletHash: "wallet-b", legacyIdentityHash: "legacy-b" });
  assert.strictEqual(attribution.status, "opened");
  const settled = await referralService.settleFirstDownload({ inviteeWalletHash: "wallet-b", jobId: "job-2", downloadTokenId: "download-1", signals: { suspicious: false } });
  assert.strictEqual(settled.status, "rewarded");
  assert.strictEqual(repo.calls.at(-1)[0], "settle");

  const admin = await referralService.updateAdminSettings({ enabled: true, dailyRewardCap: 25, adminSessionHash: "admin-hash" });
  assert.strictEqual(Number(admin.daily_reward_cap), 25);
  console.log("referral service tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
