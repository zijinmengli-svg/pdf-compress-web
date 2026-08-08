"use strict";

const crypto = require("crypto");
const { withTransaction } = require("../payment/database");

function resultRow(result) { return result.rows[0] || null; }
function hasConnect(db) { return db && typeof db.connect === "function"; }
function asDate(value, fallback) { return value instanceof Date ? value : (value ? new Date(value) : fallback()); }

function beijingDate(value) {
  const date = asDate(value, () => new Date());
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function createReferralRepository({ pool, now = () => new Date(), timezone = "Asia/Shanghai" }) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("pool is required");
  if (timezone !== "Asia/Shanghai") throw new TypeError("timezone must be Asia/Shanghai");

  async function inTransaction(db, fn) {
    return hasConnect(db) ? withTransaction(db, fn) : fn(db);
  }

  async function walletByHash(walletHash, db) {
    return resultRow(await db.query("SELECT * FROM reward_wallets WHERE wallet_hash = $1", [walletHash]));
  }

  async function expireCredits(walletId, timestamp, db) {
    await db.query("UPDATE reward_ledger SET status = 'expired', remaining_amount = 0, updated_at = $2 WHERE wallet_id = $1 AND status = 'active' AND remaining_amount > 0 AND expires_at <= $2", [walletId, timestamp]);
  }

  async function insertGrant({ walletId, grantType, sourceReferralId = null, sourceKey, amount = 1, expiresAt, metadata = {} }, db) {
    const row = resultRow(await db.query(`INSERT INTO reward_ledger(id, wallet_id, grant_type, amount, remaining_amount, expires_at, source_referral_id, source_key, status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$4,$5,$6,$7,'active',$8,$8)
      ON CONFLICT (source_key) DO NOTHING RETURNING *`, [crypto.randomUUID(), walletId, grantType, amount, expiresAt, sourceReferralId, sourceKey, now()]));
    if (!row) return resultRow(await db.query("SELECT * FROM reward_ledger WHERE source_key = $1", [sourceKey]));
    await db.query(`INSERT INTO reward_ledger_events(id, wallet_id, ledger_id, event_type, amount, idempotency_key, metadata, created_at)
      VALUES ($1,$2,$3,'granted',$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING`, [crypto.randomUUID(), walletId, row.id, amount, `grant:${sourceKey}`, metadata, now()]);
    return row;
  }

  return {
    async getSettings(db = pool) {
      return resultRow(await db.query("SELECT * FROM referral_settings WHERE singleton = true"));
    },

    async updateSettings(input, db = pool) {
      const enabled = Boolean(input.enabled);
      const cap = Number(input.dailyRewardCap);
      if (!Number.isSafeInteger(cap) || cap < 0 || cap > 500) throw new TypeError("dailyRewardCap must be an integer from 0 to 500");
      return inTransaction(db, async (tx) => {
        const current = await this.getSettings(tx);
        const updated = resultRow(await tx.query(`UPDATE referral_settings SET enabled = $1, daily_reward_cap = $2, version = version + 1, updated_at = $3 WHERE singleton = true RETURNING *`, [enabled, cap, now()]));
        if (input.adminSessionHash) {
          await tx.query(`INSERT INTO referral_audit_log(id, admin_session_hash, action, old_values, new_values, created_at) VALUES ($1,$2,'settings_updated',$3,$4,$5)`, [crypto.randomUUID(), input.adminSessionHash, current || {}, updated || {}, now()]);
        }
        return updated;
      });
    },

    async ensureWallet({ walletHash, legacyIdentityHash = "" }, db = pool) {
      if (!String(walletHash || "").trim()) throw new TypeError("walletHash is required");
      const timestamp = now();
      return resultRow(await db.query(`INSERT INTO reward_wallets(id, wallet_hash, legacy_identity_hash, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$4)
        ON CONFLICT (wallet_hash) DO UPDATE SET legacy_identity_hash = COALESCE(reward_wallets.legacy_identity_hash, EXCLUDED.legacy_identity_hash), updated_at = EXCLUDED.updated_at
        RETURNING *`, [crypto.randomUUID(), walletHash, legacyIdentityHash || null, timestamp]));
    },

    async ensureInviteCode({ walletId, codeHash }, db = pool) {
      const existing = resultRow(await db.query("SELECT * FROM referral_invite_codes WHERE wallet_id = $1", [walletId]));
      if (existing) return existing;
      return resultRow(await db.query(`INSERT INTO referral_invite_codes(id, wallet_id, code_hash, created_at) VALUES ($1,$2,$3,$4) RETURNING *`, [crypto.randomUUID(), walletId, codeHash, now()]));
    },

    async lockFirstTouch({ inviteCodeHash, inviteeWalletId }, db = pool) {
      return inTransaction(db, async (tx) => {
        const existing = resultRow(await tx.query("SELECT r.*, w.wallet_hash AS inviter_wallet_hash FROM referrals r JOIN reward_wallets w ON w.id = r.inviter_wallet_id WHERE r.invitee_wallet_id = $1 FOR UPDATE", [inviteeWalletId]));
        if (existing) return existing;
        const code = resultRow(await tx.query("SELECT * FROM referral_invite_codes WHERE code_hash = $1", [inviteCodeHash]));
        if (!code) return null;
        return resultRow(await tx.query(`INSERT INTO referrals(id, inviter_wallet_id, invitee_wallet_id, invite_code_hash, status, created_at, updated_at)
          VALUES ($1,$2,$3,$4,'opened',$5,$5) RETURNING *`, [crypto.randomUUID(), code.wallet_id, inviteeWalletId, inviteCodeHash, now()]));
      });
    },

    async ensureWelcomeCredit({ walletId, legacyIdentityHash = "" }, db = pool) {
      return inTransaction(db, async (tx) => {
        const sourceKey = `welcome:${legacyIdentityHash || walletId}`;
        const legacy = legacyIdentityHash
          ? resultRow(await tx.query("SELECT restored_at FROM free_grants WHERE anonymous_identity_hash = $1", [legacyIdentityHash]))
          : null;
        if (legacy && !legacy.restored_at) return { granted: false, reason: "legacy_consumed" };
        const settings = await this.getSettings(tx);
        const expiresAt = new Date(now().getTime() + Number(settings.reward_expiry_days || 90) * 24 * 60 * 60 * 1000);
        const row = await insertGrant({ walletId, grantType: "welcome", sourceKey, expiresAt, metadata: { legacyIdentityHash: legacyIdentityHash || "" } }, tx);
        return { granted: true, ledgerId: row.id, duplicate: row.source_key === sourceKey && row.created_at < now() };
      });
    },

    async getWalletStatus({ walletHash }, db = pool) {
      const wallet = await walletByHash(walletHash, db);
      if (!wallet) return { available: 0, grants: [] };
      await expireCredits(wallet.id, now(), db);
      const result = await db.query("SELECT grant_type, remaining_amount, expires_at, source_referral_id FROM reward_ledger WHERE wallet_id = $1 AND status = 'active' AND remaining_amount > 0 ORDER BY expires_at ASC, created_at ASC", [wallet.id]);
      return { available: result.rows.reduce((sum, row) => sum + Number(row.remaining_amount), 0), grants: result.rows };
    },

    async consumeCredit({ walletId, jobId, idempotencyKey }, db = pool) {
      return inTransaction(db, async (tx) => {
        const duplicate = resultRow(await tx.query("SELECT * FROM reward_ledger_events WHERE idempotency_key = $1 AND event_type = 'spent'", [idempotencyKey]));
        if (duplicate) return { granted: true, duplicate: true, source: "ledger", ledgerId: duplicate.ledger_id };
        const timestamp = now();
        await expireCredits(walletId, timestamp, tx);
        const grant = resultRow(await tx.query("SELECT * FROM reward_ledger WHERE wallet_id = $1 AND status = 'active' AND remaining_amount > 0 AND expires_at > $2 ORDER BY expires_at ASC, created_at ASC LIMIT 1 FOR UPDATE", [walletId, timestamp]));
        if (!grant) return { granted: false, source: "none", remaining: 0 };
        const remaining = Number(grant.remaining_amount) - 1;
        await tx.query("UPDATE reward_ledger SET remaining_amount = $2, status = $3, updated_at = $4 WHERE id = $1", [grant.id, remaining, remaining > 0 ? "active" : "consumed", timestamp]);
        await tx.query(`INSERT INTO reward_ledger_events(id, wallet_id, ledger_id, event_type, amount, job_id, idempotency_key, created_at)
          VALUES ($1,$2,$3,'spent',1,$4,$5,$6)`, [crypto.randomUUID(), walletId, grant.id, jobId, idempotencyKey, timestamp]);
        return { granted: true, source: grant.grant_type, ledgerId: grant.id, remaining };
      });
    },

    async settleReferral({ inviteeWalletId, jobId, downloadTokenId, risk = {} }, db = pool) {
      return inTransaction(db, async (tx) => {
        const referral = resultRow(await tx.query("SELECT * FROM referrals WHERE invitee_wallet_id = $1 FOR UPDATE", [inviteeWalletId]));
        if (!referral) return { status: "blocked", reason: "no_attribution" };
        if (referral.status === "rewarded" || referral.first_download_job_id) return { status: "already_settled" };
        if (risk.suspicious) {
          await tx.query("UPDATE referrals SET status = 'blocked', blocked_reason = $2, risk = $3, updated_at = $4 WHERE id = $1", [referral.id, risk.reason || "risk_signal", risk, now()]);
          return { status: "blocked", reason: risk.reason || "risk_signal" };
        }
        if (referral.inviter_wallet_id === referral.invitee_wallet_id) {
          await tx.query("UPDATE referrals SET status = 'blocked', blocked_reason = 'self_referral', updated_at = $2 WHERE id = $1", [referral.id, now()]);
          return { status: "blocked", reason: "self_referral" };
        }
        const settings = await this.getSettings(tx);
        if (!settings || !settings.enabled) return { status: "blocked", reason: "disabled" };
        const inviterCount = await tx.query("SELECT COUNT(*)::int AS count FROM referrals WHERE inviter_wallet_id = $1 AND status = 'rewarded'", [referral.inviter_wallet_id]);
        if (Number(inviterCount.rows[0].count) >= Number(settings.max_referrals_per_inviter)) {
          await tx.query("UPDATE referrals SET status = 'blocked', blocked_reason = 'inviter_limit', updated_at = $2 WHERE id = $1", [referral.id, now()]);
          return { status: "blocked", reason: "inviter_limit" };
        }
        const calendarDate = beijingDate(now());
        await tx.query("INSERT INTO referral_daily_counters(calendar_date) VALUES ($1) ON CONFLICT (calendar_date) DO NOTHING", [calendarDate]);
        const counter = resultRow(await tx.query("SELECT * FROM referral_daily_counters WHERE calendar_date = $1 FOR UPDATE", [calendarDate]));
        if (Number(counter.valid_friend_count) >= Number(settings.daily_reward_cap)) {
          await tx.query("UPDATE referrals SET status = 'cap_reached', blocked_reason = 'daily_cap', updated_at = $2 WHERE id = $1", [referral.id, now()]);
          return { status: "cap_reached" };
        }
        const timestamp = now();
        const expiresAt = new Date(timestamp.getTime() + Number(settings.reward_expiry_days) * 24 * 60 * 60 * 1000);
        await insertGrant({ walletId: referral.inviter_wallet_id, grantType: "referral_inviter", sourceReferralId: referral.id, sourceKey: `referral:${referral.id}:inviter`, expiresAt }, tx);
        await insertGrant({ walletId: referral.invitee_wallet_id, grantType: "referral_friend", sourceReferralId: referral.id, sourceKey: `referral:${referral.id}:friend`, expiresAt }, tx);
        await tx.query("UPDATE referrals SET status = 'rewarded', first_compression_job_id = $2, first_download_token_id = $3, first_download_at = $4, updated_at = $4 WHERE id = $1", [referral.id, jobId, downloadTokenId, timestamp]);
        await tx.query("UPDATE reward_wallets SET first_successful_download_at = COALESCE(first_successful_download_at, $2), updated_at = $2 WHERE id = $1", [referral.invitee_wallet_id, timestamp]);
        await tx.query("UPDATE referral_daily_counters SET valid_friend_count = valid_friend_count + 1, updated_at = $2 WHERE calendar_date = $1", [calendarDate, timestamp]);
        return { status: "rewarded", inviterWalletId: referral.inviter_wallet_id, inviteeWalletId: referral.invitee_wallet_id };
      });
    },

    async getAdminSummary({ from = new Date(0), to = now() } = {}, db = pool) {
      const result = await db.query(`SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN status = 'rewarded' THEN 1 ELSE 0 END)::int AS rewarded,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END)::int AS blocked,
        SUM(CASE WHEN status = 'cap_reached' THEN 1 ELSE 0 END)::int AS cap_reached
        FROM referrals WHERE created_at >= $1 AND created_at < $2`, [from, to]);
      const credits = await db.query("SELECT COALESCE(SUM(amount), 0)::int AS total FROM reward_ledger_events WHERE event_type = 'granted' AND created_at >= $1 AND created_at < $2", [from, to]);
      const settings = await this.getSettings(db);
      const today = beijingDate(now());
      const counter = resultRow(await db.query("SELECT valid_friend_count FROM referral_daily_counters WHERE calendar_date = $1", [today]));
      return { ...result.rows[0], rewardCredits: Number(credits.rows[0].total), dailyCap: Number(settings.daily_reward_cap), dailyUsed: counter ? Number(counter.valid_friend_count) : 0, dailyRemaining: Math.max(0, Number(settings.daily_reward_cap) - Number(counter ? counter.valid_friend_count : 0)) };
    },

    async listAdminEvents({ limit = 100, status = "" } = {}, db = pool) {
      const bounded = Math.min(Math.max(Number(limit) || 100, 1), 200);
      if (status) return (await db.query("SELECT * FROM referrals WHERE status = $1 ORDER BY updated_at DESC LIMIT $2", [status, bounded])).rows;
      return (await db.query("SELECT * FROM referrals ORDER BY updated_at DESC LIMIT $1", [bounded])).rows;
    },

    async migrateLegacyFreeGrants(db = pool) {
      const rows = await db.query("SELECT anonymous_identity_hash, restored_at FROM free_grants WHERE restored_at IS NOT NULL");
      return { restoredRows: rows.rowCount };
    },
  };
}

module.exports = { beijingDate, createReferralRepository };
