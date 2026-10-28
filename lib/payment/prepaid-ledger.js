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

  async function getBalance({ walletHash }, db = pool) {
    if (!String(walletHash || "").trim()) return { available: 0 };
    const result = await db.query(`SELECT COALESCE(SUM(l.remaining_amount),0)::int AS available
      FROM reward_wallets w JOIN reward_ledger l ON l.wallet_id = w.id
      WHERE w.wallet_hash = $1 AND l.status = 'active' AND l.expires_at > $2`, [walletHash, now()]);
    return { available: Number(result.rows[0]?.available || 0) };
  }

  async function consumeSuccessfulJob({ walletHash, jobId }) {
    if (!String(walletHash || "").trim() || !String(jobId || "").trim()) throw new TypeError("wallet and successful job are required");
    return withTransaction(pool, async tx => {
      const wallet = (await tx.query("SELECT id FROM reward_wallets WHERE wallet_hash = $1", [walletHash])).rows[0];
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

  return { ensureWallet, grantPurchasedCredit, getBalance, consumeSuccessfulJob };
}

module.exports = { createPrepaidLedger };
