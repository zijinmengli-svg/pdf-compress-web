"use strict";

const { withTransaction } = require("./database");
const DAY_MS = 86_400_000;
const OFFSET_MS = 21_600_000; // Beijing 02:00 is UTC 18:00.

function createCompressionQuota({ pool, ledger, now = Date.now, leaseMs }) {
  function window() {
    const start = Math.floor((now() + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;
    return { startsAt: new Date(start), resetsAt: new Date(start + DAY_MS).toISOString() };
  }
  function scopes({ guestHash, accountId }) {
    if (!guestHash) throw new TypeError("Guest identity required");
    return [`guest:${guestHash}`, ...(accountId ? [`account:${accountId}`] : [])].sort();
  }
  async function balance(identity) {
    const { startsAt, resetsAt } = window();
    const active = await pool.query("SELECT 1 FROM compression_daily_claims WHERE starts_at=$1 AND scope=ANY($2::text[]) LIMIT 1", [startsAt, scopes(identity)]);
    const free = active.rowCount ? 0 : 1;
    const paid = identity.walletHash ? (await ledger.getBalance({ walletHash: identity.walletHash, purchasedOnly: true })).available : 0;
    return { available: free + paid, free, paid, resetsAt, timezone: "Asia/Shanghai" };
  }
  async function reserve(identity, jobId) {
    const { startsAt } = window();
    const leaseExpiresAt = leaseMs ? new Date(now() + leaseMs) : null;
    const taken = new Error("Daily credit already in use");
    try {
      await withTransaction(pool, async tx => {
        for (const scope of scopes(identity)) {
          const inserted = await tx.query(`INSERT INTO compression_daily_claims(scope,starts_at,job_id)
            VALUES ($1,$2,$3) ON CONFLICT (scope,starts_at) DO NOTHING`, [scope, startsAt, jobId]);
          if (!inserted.rowCount) throw taken;
        }
        if (leaseExpiresAt) {
          await tx.query("UPDATE compression_daily_claims SET lease_expires_at=$2 WHERE job_id=$1", [jobId, leaseExpiresAt]);
        }
      });
      return { kind: "free", jobId };
    } catch (error) {
      if (error !== taken) throw error;
    }
    if (!identity.walletHash) return null;
    const { reserved } = await ledger.reserveJob({ walletHash: identity.walletHash, jobId, purchasedOnly: true, leaseExpiresAt });
    return reserved ? { kind: "paid", walletHash: identity.walletHash, jobId } : null;
  }
  async function finish(reservation, success) {
    if (reservation.kind === "paid") {
      const result = await ledger.finishJob({ ...reservation, success });
      if (success && result.status !== "spent") throw new Error("Paid credit could not be settled");
      return;
    }
    if (success) {
      const completed = await pool.query(`UPDATE compression_daily_claims SET spent=true
        WHERE job_id=$1 AND (lease_expires_at IS NULL OR lease_expires_at > $2)`, [reservation.jobId, new Date(now())]);
      if (!completed.rowCount) throw new Error("Free credit could not be settled");
    } else {
      await pool.query("DELETE FROM compression_daily_claims WHERE job_id=$1 AND NOT spent", [reservation.jobId]);
    }
  }
  async function recoverExpired() {
    await pool.query("DELETE FROM compression_daily_claims WHERE NOT spent AND lease_expires_at <= $1", [new Date(now())]);
    await ledger.recoverExpiredJobs();
  }
  return { balance, reserve, finish, recoverExpired };
}

module.exports = { createCompressionQuota };
