"use strict";

const crypto = require("node:crypto");
const { resolveAccountWallet } = require("./account-wallet");
const { withTransaction } = require("./database");

function createTinyPdfAdapter({ pool, authService, ledger, identityHashSecret }) {
  if (!pool || !authService || !ledger || !String(identityHashSecret || "")) {
    throw new TypeError("TinyPDF payment adapter dependencies are required");
  }

  async function resolveSubject(sessionToken, guestWalletHash) {
    const wallet = await resolveAccountWallet({ pool, authService, sessionToken, guestWalletHash, secret: identityHashSecret });
    return { namespace: "tinypdf", id: wallet.accountId, walletHash: wallet.walletHash };
  }

  function validateOrder({ transactionId, subject, units }) {
    if (!/^txn_[A-Za-z0-9_]+$/.test(String(transactionId || "")) ||
        !subject || subject.namespace !== "tinypdf" || !subject.id || !subject.walletHash ||
        !Number.isSafeInteger(units) || units < 1) throw new TypeError("Invalid TinyPDF payment order");
  }

  async function accountWallet(subject, db) {
    const row = (await db.query("SELECT wallet_hash FROM account_wallets WHERE account_id = $1", [subject.id])).rows[0];
    if (!row || row.wallet_hash !== subject.walletHash) throw new Error("TinyPDF account wallet binding mismatch");
  }

  async function grant(order) {
    validateOrder(order);
    const { transactionId, subject, units } = order;
    const run = async db => {
      await accountWallet(subject, db);
      const prior = (await db.query("SELECT id,amount,wallet_id FROM reward_ledger WHERE source_key=$1", [`purchase:${transactionId}`])).rows[0];
      if (prior) {
        const owner = (await db.query("SELECT wallet_hash FROM reward_wallets WHERE id=$1", [prior.wallet_id])).rows[0];
        if (!owner || owner.wallet_hash !== subject.walletHash || Number(prior.amount) !== units) {
          throw new Error("TinyPDF purchase grant binding mismatch");
        }
        return { granted: false, ledgerId: prior.id };
      }
      const wallet = await ledger.ensureWallet({ walletHash: subject.walletHash }, db);
      return ledger.grantPurchasedCredit({ walletId: wallet.id, transactionId, quantity: units,
        expiresAt: new Date("9999-12-31T00:00:00.000Z") }, db);
    };
    return order.tx ? run(order.tx) : withTransaction(pool, run);
  }

  async function refundEligibility(order) {
    validateOrder(order);
    const { transactionId, subject, units } = order;
    const db = order.tx || pool;
    await accountWallet(subject, db);
    const row = (await db.query(`SELECT l.status,l.amount,l.remaining_amount FROM reward_ledger l
      JOIN reward_wallets w ON w.id = l.wallet_id
      WHERE l.source_key = $1 AND w.wallet_hash = $2`, [`purchase:${transactionId}`, subject.walletHash])).rows[0];
    return { eligible: Boolean(row && row.status === "active" && Number(row.amount) === units && Number(row.remaining_amount) === units),
      remaining: row ? Number(row.remaining_amount) : 0 };
  }

  async function changeFreeze(order, action) {
    validateOrder(order);
    const run = async db => {
      await accountWallet(order.subject, db);
      const source = `purchase:${order.transactionId}`;
      const row = (await db.query(`SELECT l.id,l.wallet_id,l.amount,l.remaining_amount,l.status FROM reward_ledger l
        JOIN reward_wallets w ON w.id=l.wallet_id WHERE l.source_key=$1 AND w.wallet_hash=$2 FOR UPDATE`,
      [source, order.subject.walletHash])).rows[0];
      if (!row || Number(row.amount) !== order.units) return { frozen: false, restored: false, revoked: false };
      let next;
      if (action === "freeze" && row.status === "active" && Number(row.remaining_amount) === order.units) next = "frozen";
      if (action === "restore" && row.status === "frozen") next = "active";
      if (action === "revoke" && row.status === "frozen") next = "revoked";
      if (!next) return { frozen: false, restored: false, revoked: false };
      await db.query("UPDATE reward_ledger SET status=$2, remaining_amount=$3, updated_at=now() WHERE id=$1",
        [row.id, next, next === "revoked" ? 0 : row.remaining_amount]);
      await db.query(`INSERT INTO reward_ledger_events(id,wallet_id,ledger_id,event_type,amount,idempotency_key,metadata,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (idempotency_key) DO NOTHING`,
      [crypto.randomUUID(), row.wallet_id, row.id, action === "freeze" ? "frozen" : action === "restore" ? "restored" : "revoked",
        Number(row.remaining_amount), `${action}:${source}`, { orderId: order.orderId, transactionId: order.transactionId }]);
      return { frozen: action === "freeze", restored: action === "restore", revoked: action === "revoke" };
    };
    return order.tx ? run(order.tx) : withTransaction(pool, run);
  }

  return { resolveSubject, grant, refundEligibility,
    freezeUnused: order => changeFreeze(order, "freeze"),
    restoreFrozen: order => changeFreeze(order, "restore"),
    revokeFrozen: order => changeFreeze(order, "revoke") };
}

module.exports = { createTinyPdfAdapter };
