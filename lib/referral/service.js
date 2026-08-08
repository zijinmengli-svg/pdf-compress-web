"use strict";

const { createInviteCode, hashInviteCode } = require("./wallet");

function normalizedOrigin(value) {
  try {
    const url = new URL(String(value || "https://tinypdf.cn"));
    if (!/^https?:$/.test(url.protocol)) throw new Error("invalid origin");
    return `${url.protocol}//${url.host}`;
  } catch {
    return "https://tinypdf.cn";
  }
}

function createReferralService({ repo, creditService, secret, origin = "https://tinypdf.cn", now = () => new Date() }) {
  if (!repo || !creditService || !String(secret || "").trim()) throw new TypeError("repo, creditService, and secret are required");
  const baseOrigin = normalizedOrigin(origin);

  return {
    async captureAttribution({ inviteCode, inviteeWalletHash, legacyIdentityHash = "" }, db) {
      const wallet = await repo.ensureWallet({ walletHash: inviteeWalletHash, legacyIdentityHash }, db);
      const codeHash = hashInviteCode(inviteCode, secret);
      const referral = await repo.lockFirstTouch({ inviteCodeHash: codeHash, inviteeWalletId: wallet.id, now: now() }, db);
      return referral ? { status: referral.status, referralId: referral.id } : { status: "invalid_code", referralId: null };
    },

    async getPublicStatus({ walletHash, legacyIdentityHash = "", language = "en" }, db) {
      const settings = await repo.getSettings(db);
      if (!settings || !settings.enabled) return { enabled: false, balance: 0, shareUrl: "", rewardPerSide: 1, expiresInDays: 90 };
      const wallet = await repo.ensureWallet({ walletHash, legacyIdentityHash }, db);
      const inviteCode = createInviteCode({ walletId: wallet.id, secret });
      await repo.ensureInviteCode({ walletId: wallet.id, codeHash: hashInviteCode(inviteCode, secret) }, db);
      const status = await creditService.getBalance({ walletHash, legacyIdentityHash }, db);
      return {
        enabled: true,
        balance: Number(status.available || 0),
        nearestExpiry: status.grants && status.grants[0] ? status.grants[0].expires_at : null,
        shareUrl: `${baseOrigin}${language === "zh" ? "/zh/" : "/"}?ref=${encodeURIComponent(inviteCode)}`,
        rewardPerSide: Number(settings.reward_per_side || 1),
        expiresInDays: Number(settings.reward_expiry_days || 90),
      };
    },

    async settleFirstDownload({ inviteeWalletHash, jobId, downloadTokenId, signals = {} }, db) {
      const wallet = await repo.ensureWallet({ walletHash: inviteeWalletHash }, db);
      return repo.settleReferral({ inviteeWalletId: wallet.id, jobId, downloadTokenId, risk: signals, now: now() }, db);
    },

    async getAdminData({ from, to, limit = 100, status = "" }, db) {
      const [settings, summary, events] = await Promise.all([
        repo.getSettings(db),
        repo.getAdminSummary({ from, to, now: now() }, db),
        repo.listAdminEvents({ limit, status }, db),
      ]);
      return { settings, summary, events };
    },

    async updateAdminSettings({ enabled, dailyRewardCap, adminSessionHash }, db) {
      return repo.updateSettings({ enabled, dailyRewardCap, adminSessionHash, now: now() }, db);
    },
  };
}

module.exports = { createReferralService };
