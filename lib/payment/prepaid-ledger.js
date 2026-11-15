"use strict";

const crypto = require("node:crypto");
const { withTransaction } = require("./database");

function createPrepaidLedger({ pool, now = () => new Date() }) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("pool is required");

  async function ensureWallet({ walletHash }, db = pool) {
    if (!String(walletHash || "").trim()) throw new TypeError("wallet hash is required");
    const row = (await db.query(`INSERT INTO reward_wallets(id,wallet_hash,created_at,updated_at)
      VALUES ($1,$2,$3,$3) ON CONFLICT (wallet_hash) DO UPDATE SET updated_at = EXCLUDED.updated_at RETURNING *`,
    [crypto.randomUUID(), walletHash, now()])).rows[0];
    return row;
  }

  async function grantPurchasedCredit({ walletId, transactionId, quantity, expiresAt }, db = pool) {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) throw new TypeError("invalid credit quantity");
    if (!/^txn_[A-Za-z0-9_]+$/.test(String(transactionId || ""))) throw new TypeError("invalid transaction ID");
    const sourceKey = `purchase:${transactionId}`;
    const row = (await db.query(`INSERT INTO reward_ledger(id,wallet_id,grant_type,amount,remaining_amount,expires_at,source_key,status,created_at,updated_at)
      VALUES ($1,$2,'purchase',$3,$3,$4,$5,'active',$6,$6)
      ON CONFLICT (source_key) DO NOTHING RETURNING id`,
    [crypto.randomUUID(), walletId, quantity, expiresAt, sourceKey, now()])).rows[0];
    if (row) {
      await db.query(`INSERT INTO reward_ledger_events(id,wallet_id,ledger_id,event_type,amount,idempotency_key,metadata,created_at)
        VALUES ($1,$2,$3,'granted',$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING`,
      [crypto.randomUUID(), walletId, row.id, quantity, `grant:${sourceKey}`, { transactionId }, now()]);
    }
    return { granted: Boolean(row), ledgerId: row && row.id };
  }

  async function ensureDailyFreeCredit({ walletHash }, db) {
    const instant = now();
    // UTC+8 02:00 is UTC 18:00 on the preceding calendar date.
    const day = 86_400_000;
    const start = Math.floor((instant.getTime() + 6 * 3_600_000) / day) * day - 6 * 3_600_000;
    const run = async tx => {
      const wallet = await ensureWallet({ walletHash }, tx);
      const sourceKey = `daily:${wallet.id}:${start}`;
      const row = (await tx.query(`INSERT INTO reward_ledger(id,wallet_id,grant_type,amount,remaining_amount,expires_at,source_key,status,created_at,updated_at)
        VALUES ($1,$2,'welcome',1,1,$3,$4,'active',$5,$5)
        ON CONFLICT (source_key) DO NOTHING RETURNING id`,
      [crypto.randomUUID(), wallet.id, new Date(start + day), sourceKey, instant])).rows[0];
      if (row) await tx.query(`INSERT INTO reward_ledger_events(id,wallet_id,ledger_id,event_type,amount,idempotency_key,metadata,created_at)
        VALUES ($1,$2,$3,'granted',1,$4,$5,$6) ON CONFLICT (idempotency_key) DO NOTHING`,
      [crypto.randomUUID(), wallet.id, row.id, `grant:${sourceKey}`, { policy: "daily-free", resetsAt: new Date(start + day).toISOString() }, instant]);
      return { granted: Boolean(row), resetsAt: new Date(start + day).toISOString() };
    };
    return db ? run(db) : withTransaction(pool, run);
  }

  async function getBalance({ walletHash, purchasedOnly = false }, db = pool) {
    if (!String(walletHash || "").trim()) return { available: 0 };
    const result = await db.query(`SELECT COALESCE(SUM(l.remaining_amount),0)::int AS available
      FROM reward_wallets w JOIN reward_ledger l ON l.wallet_id = w.id
      WHERE w.wallet_hash = $1 AND l.status = 'active' AND l.expires_at > $2
      ${purchasedOnly ? "AND l.grant_type = 'purchase'" : ""}`, [walletHash, now()]);
    return { available: Number(result.rows[0]?.available || 0) };
  }

  async function consumeSuccessfulJob({ walletHash, jobId }) {
    if (!String(walletHash || "").trim() || !String(jobId || "").trim()) throw new TypeError("wallet and successful job are required");
    return withTransaction(pool, async tx => {
      const wallet = (await tx.query("SELECT id FROM reward_wallets WHERE wallet_hash = $1 FOR UPDATE", [walletHash])).rows[0];
      if (!wallet) return { spent: false, duplicate: false, remaining: 0 };
      const key = `spend:${walletHash}:${jobId}`;
      const previous = (await tx.query("SELECT id FROM reward_ledger_events WHERE idempotency_key = $1", [key])).rows[0];
      if (previous) return { spent: true, duplicate: true, remaining: (await getBalance({ walletHash }, tx)).available };
      const grant = (await tx.query(`SELECT id,remaining_amount FROM reward_ledger
        WHERE wallet_id = $1 AND status = 'active' AND remaining_amount > 0 AND expires_at > $2
        ORDER BY expires_at ASC, created_at ASC LIMIT 1 FOR UPDATE`, [wallet.id, now()])).rows[0];
      if (!grant) return { spent: false, duplicate: false, remaining: 0 };
      const after = Number(grant.remaining_amount) - 1;
      await tx.query("UPDATE reward_ledger SET remaining_amount = $2, status = $3, updated_at = $4 WHERE id = $1", [grant.id, after, after ? "active" : "consumed", now()]);
      await tx.query(`INSERT INTO reward_ledger_events(id,wallet_id,ledger_id,event_type,amount,job_id,idempotency_key,created_at)
        VALUES ($1,$2,$3,'spent',1,$4,$5,$6)`, [crypto.randomUUID(), wallet.id, grant.id, jobId, key, now()]);
      return { spent: true, duplicate: false, remaining: (await getBalance({ walletHash }, tx)).available };
    });
  }

  async function reserveJob({ walletHash, jobId, purchasedOnly = false, leaseExpiresAt }) {
    if (!String(walletHash || "").trim() || !String(jobId || "").trim()) throw new TypeError("wallet and job are required");
    return withTransaction(pool, async tx => {
      const wallet = await ensureWallet({ walletHash }, tx);
      const prior = (await tx.query("SELECT wallet_id,status FROM prepaid_job_reservations WHERE job_id=$1", [jobId])).rows[0];
      if (prior) return { reserved: prior.wallet_id === wallet.id && prior.status === "reserved", duplicate: true };
      const grant = (await tx.query(`SELECT id,remaining_amount FROM reward_ledger
        WHERE wallet_id=$1 AND status='active' AND remaining_amount>0 AND expires_at>$2
        ${purchasedOnly ? "AND grant_type = 'purchase'" : ""}
        ORDER BY expires_at ASC, created_at ASC LIMIT 1 FOR UPDATE`, [wallet.id, now()])).rows[0];
      if (!grant) return { reserved: false, duplicate: false };
      const after = Number(grant.remaining_amount) - 1;
      await tx.query("UPDATE reward_ledger SET remaining_amount=$2,status=$3,updated_at=$4 WHERE id=$1",
        [grant.id, after, after ? "active" : "consumed", now()]);
      await tx.query(`INSERT INTO prepaid_job_reservations(job_id,wallet_id,ledger_id,status,created_at,updated_at)
        VALUES ($1,$2,$3,'reserved',$4,$4)`, [jobId, wallet.id, grant.id, now()]);
      if (leaseExpiresAt) {
        await tx.query("UPDATE prepaid_job_reservations SET lease_expires_at=$2 WHERE job_id=$1", [jobId, leaseExpiresAt]);
      }
      return { reserved: true, duplicate: false };
    });
  }

  async function finishJob({ walletHash, jobId, success }) {
    if (!String(walletHash || "").trim() || !String(jobId || "").trim() || typeof success !== "boolean") throw new TypeError("wallet, job and result are required");
    return withTransaction(pool, async tx => {
      const wallet = (await tx.query("SELECT id FROM reward_wallets WHERE wallet_hash=$1 FOR UPDATE", [walletHash])).rows[0];
      if (!wallet) return { changed: false };
      const reservation = (await tx.query("SELECT * FROM prepaid_job_reservations WHERE job_id=$1 AND wallet_id=$2 FOR UPDATE", [jobId, wallet.id])).rows[0];
      if (!reservation || reservation.status !== "reserved") return { changed: false };
      if (success && reservation.lease_expires_at && new Date(reservation.lease_expires_at) <= now()) {
        return { changed: false, status: "expired" };
      }
      const grant = (await tx.query("SELECT * FROM reward_ledger WHERE id=$1 FOR UPDATE", [reservation.ledger_id])).rows[0];
      let status = success ? "spent" : "released";
      if (["frozen", "revoked"].includes(grant.status)) {
        // External refunds require reconciliation, never silently restore spendable credit.
        status = "review";
      } else if (success) {
        await tx.query(`INSERT INTO reward_ledger_events(id,wallet_id,ledger_id,event_type,amount,job_id,idempotency_key,created_at)
          VALUES ($1,$2,$3,'spent',1,$4,$5,$6)`,
        [crypto.randomUUID(), wallet.id, grant.id, jobId, `spend:${walletHash}:${jobId}`, now()]);
      } else {
        // Preserve the original expiry: a failed job cannot carry yesterday's free credit forward.
        await tx.query("UPDATE reward_ledger SET remaining_amount=$2,status=$3,updated_at=$4 WHERE id=$1",
          [grant.id, Number(grant.remaining_amount) + 1, new Date(grant.expires_at) > now() ? "active" : "expired", now()]);
      }
      await tx.query("UPDATE prepaid_job_reservations SET status=$2,updated_at=$3 WHERE job_id=$1", [jobId, status, now()]);
      return { changed: true, status };
    });
  }

  async function recoverExpiredJobs() {
    const expired = await pool.query(`SELECT r.job_id,w.wallet_hash FROM prepaid_job_reservations r
      JOIN reward_wallets w ON w.id=r.wallet_id WHERE r.status='reserved' AND r.lease_expires_at <= $1
      ORDER BY r.lease_expires_at, r.job_id LIMIT 100`, [now()]);
    // Use the same wallet-first transaction and one-time state transition as normal failure.
    for (const row of expired.rows) await finishJob({ walletHash: row.wallet_hash, jobId: row.job_id, success: false });
  }

  return { ensureWallet, grantPurchasedCredit, ensureDailyFreeCredit, getBalance, consumeSuccessfulJob, reserveJob, finishJob, recoverExpiredJobs };
}

module.exports = { createPrepaidLedger };
