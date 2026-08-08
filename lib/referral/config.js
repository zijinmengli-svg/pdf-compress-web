"use strict";

const DEFAULTS = Object.freeze({
  dailyRewardCap: 50,
  rewardPerSide: 1,
  rewardExpiryDays: 90,
  walletCookieDays: 365,
  maxReferralsPerInviter: 20,
  timezone: "Asia/Shanghai",
});

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function loadReferralConfig(env = process.env) {
  const walletSecret = String(env.REFERRAL_WALLET_SECRET || env.WEB_SESSION_SECRET || "").trim();
  return {
    enabled: String(env.REFERRAL_ENABLED || "").trim().toLowerCase() === "true",
    dailyRewardCap: integer(env.REFERRAL_DAILY_CAP, DEFAULTS.dailyRewardCap, 0, 500),
    rewardPerSide: DEFAULTS.rewardPerSide,
    rewardExpiryDays: DEFAULTS.rewardExpiryDays,
    walletCookieDays: DEFAULTS.walletCookieDays,
    maxReferralsPerInviter: DEFAULTS.maxReferralsPerInviter,
    timezone: DEFAULTS.timezone,
    walletSecret,
  };
}

module.exports = { DEFAULTS, loadReferralConfig };
