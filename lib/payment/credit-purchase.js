"use strict";

const crypto = require("crypto");
const { withTransaction } = require("./database");

const INTENT_LIFETIME_MS = 7 * 24 * 60 * 60_000;
const PRACTICALLY_NEVER = new Date("9999-12-31T00:00:00.000Z");
const PURCHASE_OPTIONS = new Set([1, 3, 5, 10]);

function base64url(value) { return Buffer.from(value).toString("base64url"); }
function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function listAccountPurchaseHistory({ pool, accountId, walletHash, limit = 50 }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(accountId || "")) || !String(walletHash || "").trim()) return [];
  const bounded = Math.min(100, Math.max(1, Math.floor(Number(limit) || 50)));
  const rows = (await pool.query(`SELECT p.transaction_id, p.quantity, p.customer_amount_minor, p.customer_currency, p.status, p.created_at,
    l.status AS credit_status, l.remaining_amount FROM credit_purchases p
    LEFT JOIN reward_ledger l ON l.source_key = 'purchase:' || p.transaction_id
    WHERE p.account_id = $1 AND p.wallet_hash = $2 ORDER BY p.created_at DESC LIMIT $3`, [accountId, walletHash, bounded])).rows;
  return rows.map(row => ({ transactionId: row.transaction_id, quantity: Number(row.quantity),
    remaining: row.credit_status === "active" ? Number(row.remaining_amount) : 0,
    amountMinor: Number(row.customer_amount_minor), currency: row.customer_currency, status: row.status, createdAt: row.created_at }));
}

function createCreditPurchaseService({ pool, referralRepo, intentSecret, getSettings, now = () => new Date() }) {
  if (!pool || !referralRepo || !String(intentSecret || "").trim() || typeof getSettings !== "function") throw new TypeError("credit purchase dependencies are required");
  const sign = (payload) => crypto.createHmac("sha256", intentSecret).update(payload).digest("base64url");

  function createIntent({ walletHash, accountId, quantity = 1 }) {
    if (!String(walletHash || "").trim()) throw new TypeError("walletHash is required");
    if (!/^[0-9a-f-]{36}$/i.test(String(accountId || ""))) throw new TypeError("verified account ID is required");
    if (!PURCHASE_OPTIONS.has(quantity)) throw new TypeError("purchase quantity must be 1, 3, 5, or 10");
    const settings = getSettings();
    if (!settings || !settings.paddle_price_id || !settings.paddle_product_id) throw new Error("purchase catalog is unavailable");
    const payload = base64url(JSON.stringify({ v: 2, walletHash, accountId, quantity, priceId: settings.paddle_price_id, productId: settings.paddle_product_id, expires: now().getTime() + INTENT_LIFETIME_MS, nonce: crypto.randomBytes(16).toString("hex") }));
    return { token: `${payload}.${sign(payload)}`, priceId: settings.paddle_price_id, quantity };
  }

  function verifyIntent(token, { ignoreExpiry = false } = {}) {
    const parts = String(token || "").split(".");
    if (parts.length !== 2 || !constantTimeEqual(sign(parts[0]), parts[1])) throw new Error("purchase intent is invalid");
    let claims;
    try { claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { throw new Error("purchase intent is invalid"); }
    if (claims.v !== 2 || !/^[0-9a-f-]{36}$/i.test(String(claims.accountId || "")) || !claims.walletHash || !claims.priceId || !claims.productId || (claims.quantity !== undefined && (!Number.isSafeInteger(claims.quantity) || claims.quantity < 1 || claims.quantity > 10)) || !Number.isSafeInteger(claims.expires) || (!ignoreExpiry && claims.expires < now().getTime())) throw new Error("purchase intent has expired or is invalid");
    return claims;
  }

  async function settleCompleted(remote) {
    if (!remote || !/^txn_[A-Za-z0-9_]+$/.test(String(remote.id || "")) || remote.status !== "completed") throw new Error("purchase transaction is incomplete");
    // A valid paid transaction must still be credited if a delayed webhook arrives after the intent's checkout lifetime.
    const claims = verifyIntent(remote.customData && remote.customData.tinypdfCreditIntent, { ignoreExpiry: true });
    const item = remote.items && remote.items.length === 1 && remote.items[0];
    const totals = remote.details && remote.details.totals;
    const quantity = item && Number(item.quantity);
    // Paddle Checkout can let buyers edit quantity. Credit the actual paid
    // quantity returned by Paddle, never the number selected on our page.
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100 || !item.price || item.price.id !== claims.priceId || item.price.productId !== claims.productId || !totals || !/^[1-9]\d*$/.test(String(totals.total || "")) || !/^[A-Z]{3}$/.test(String(totals.currencyCode || ""))) throw new Error("purchase binding mismatch");
    const amount = Number(totals.total);
    if (!Number.isSafeInteger(amount)) throw new Error("purchase binding mismatch");
    return withTransaction(pool, async (tx) => {
      const account = (await tx.query("SELECT wallet_hash FROM account_wallets WHERE account_id = $1", [claims.accountId])).rows[0];
      if (!account || account.wallet_hash !== claims.walletHash) throw new Error("purchase account binding mismatch");
      const existing = (await tx.query("SELECT * FROM credit_purchases WHERE transaction_id = $1", [remote.id])).rows[0];
      if (existing) return { granted: false, status: existing.status, transactionId: remote.id };
      const inserted = (await tx.query(`INSERT INTO credit_purchases(transaction_id, wallet_hash, account_id, paddle_price_id, paddle_product_id, quantity, customer_amount_minor, customer_currency, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed',$9,$9) ON CONFLICT (transaction_id) DO NOTHING RETURNING transaction_id`, [remote.id, claims.walletHash, claims.accountId, claims.priceId, claims.productId, quantity, amount, totals.currencyCode, now()])).rows[0];
      if (!inserted) return { granted: false, status: "completed", transactionId: remote.id };
      const wallet = await referralRepo.ensureWallet({ walletHash: claims.walletHash }, tx);
      await referralRepo.grantPurchasedCredit({ walletId: wallet.id, transactionId: remote.id, quantity, expiresAt: PRACTICALLY_NEVER }, tx);
      return { granted: true, status: "completed", transactionId: remote.id };
    });
  }

  async function getPurchaseStatus({ walletHash, transactionId }) {
    if (!String(walletHash || "").trim() || !/^txn_[A-Za-z0-9_]+$/.test(String(transactionId || ""))) return { status: "not_found" };
    const row = (await pool.query("SELECT transaction_id, status, quantity, customer_amount_minor, customer_currency FROM credit_purchases WHERE wallet_hash = $1 AND transaction_id = $2", [walletHash, transactionId])).rows[0];
    return row ? { status: row.status, transactionId: row.transaction_id, quantity: Number(row.quantity), amountMinor: Number(row.customer_amount_minor), currency: row.customer_currency } : { status: "not_found" };
  }

  const listAccountPurchases = input => listAccountPurchaseHistory({ pool, ...input });

  async function reconcile({ walletHash, transactionId, paddle }) {
    if (!String(walletHash || "").trim() || !/^txn_[A-Za-z0-9_]+$/.test(String(transactionId || ""))) throw new Error("Invalid purchase reference");
    if (!paddle || typeof paddle.getTransaction !== "function") throw new Error("Paddle transaction service is unavailable");
    const existing = await getPurchaseStatus({ walletHash, transactionId });
    if (existing.status !== "not_found") return { status: existing.status, granted: false };
    const remote = await paddle.getTransaction(transactionId);
    if (!remote || remote.id !== transactionId) throw new Error("Paddle transaction binding mismatch");
    const claims = verifyIntent(remote.customData && remote.customData.tinypdfCreditIntent, { ignoreExpiry: true });
    if (claims.walletHash !== walletHash) throw new Error("Paddle transaction binding mismatch");
    if (remote.status !== "completed") return { status: "pending", granted: false };
    return settleCompleted(remote);
  }

  async function getAdminPurchase(transactionId) {
    if (!/^txn_[A-Za-z0-9_]+$/.test(String(transactionId || ""))) return null;
    const row = (await pool.query("SELECT * FROM credit_purchases WHERE transaction_id = $1", [transactionId])).rows[0];
    if (!row) return null;
    const ledger = (await pool.query("SELECT status, remaining_amount FROM reward_ledger WHERE source_key = $1", [`purchase:${transactionId}`])).rows[0];
    return { ...row, creditRemaining: ledger && ledger.status === "active" ? Number(ledger.remaining_amount) : 0, creditStatus: ledger ? ledger.status : "missing" };
  }

  async function listAdminPurchases(limit = 50) {
    const bounded = Math.min(100, Math.max(1, Number(limit) || 50));
    const rows = (await pool.query("SELECT transaction_id, quantity, customer_amount_minor, customer_currency, status, created_at FROM credit_purchases ORDER BY created_at DESC LIMIT $1", [bounded])).rows;
    return rows;
  }

  async function revokeUnusedCredit(transactionId, tx, requiredRemaining = null) {
    const ledger = (await tx.query("SELECT id, wallet_id, remaining_amount, status FROM reward_ledger WHERE source_key = $1 FOR UPDATE", [`purchase:${transactionId}`])).rows[0];
    if (!ledger || ledger.status !== "active" || Number(ledger.remaining_amount) <= 0 || requiredRemaining !== null && Number(ledger.remaining_amount) !== requiredRemaining) return false;
    await tx.query("UPDATE reward_ledger SET status = 'revoked', remaining_amount = 0, updated_at = $2 WHERE id = $1", [ledger.id, now()]);
    await tx.query(`INSERT INTO reward_ledger_events(id, wallet_id, ledger_id, event_type, amount, idempotency_key, metadata, created_at)
      VALUES ($1,$2,$3,'revoked',$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING`, [crypto.randomUUID(), ledger.wallet_id, ledger.id, Number(ledger.remaining_amount), `revoke:purchase:${transactionId}`, { transactionId }, now()]);
    return true;
  }

  async function requestRefund({ transactionId, reason, paddle }) {
    if (!/^txn_[A-Za-z0-9_]+$/.test(String(transactionId || ""))) throw new Error("Invalid Paddle transaction ID");
    if (!["duplicate", "service_not_delivered", "other"].includes(reason)) throw new Error("Invalid refund reason");
    if (!paddle || typeof paddle.requestFullRefund !== "function") throw new Error("Paddle refund service is unavailable");
    const purchase = await getAdminPurchase(transactionId);
    if (!purchase) throw new Error("Purchase not found");
    if (purchase.status !== "completed") throw new Error("Refund already requested or completed");
    if (purchase.creditRemaining !== Number(purchase.quantity)) throw new Error("Credit already used; manual refund review required");
    const remote = await paddle.getTransaction(transactionId);
    const claims = verifyIntent(remote.customData && remote.customData.tinypdfCreditIntent, { ignoreExpiry: true });
    if (remote.status !== "completed" || remote.id !== transactionId || claims.walletHash !== purchase.wallet_hash) throw new Error("Paddle transaction binding mismatch");
    if ((await paddle.listRefundAdjustments(transactionId)).some((item) => item.action === "refund")) throw new Error("Refund already exists in Paddle; review manually");
    await withTransaction(pool, async (tx) => {
      const current = (await tx.query("SELECT status FROM credit_purchases WHERE transaction_id = $1 FOR UPDATE", [transactionId])).rows[0];
      if (!current || current.status !== "completed") throw new Error("Refund already requested or completed");
      if (!await revokeUnusedCredit(transactionId, tx, Number(purchase.quantity))) throw new Error("Credit already used; manual refund review required");
      await tx.query("UPDATE credit_purchases SET status = 'refund_pending', updated_at = $2 WHERE transaction_id = $1", [transactionId, now()]);
    });
    try {
      const adjustment = await paddle.requestFullRefund({ transactionId, reason });
      if (!adjustment || !adjustment.id || adjustment.transactionId !== transactionId || adjustment.action !== "refund" || adjustment.type !== "full") throw new Error("Paddle refund response is incomplete");
      await pool.query("UPDATE credit_purchases SET refund_adjustment_id = $2, updated_at = $3 WHERE transaction_id = $1", [transactionId, adjustment.id, now()]);
      return { status: "refund_pending", transactionId, adjustmentId: adjustment.id };
    } catch {
      await pool.query("UPDATE credit_purchases SET status = 'refund_review', updated_at = $2 WHERE transaction_id = $1", [transactionId, now()]);
      throw new Error("Refund outcome needs manual review in Paddle; do not submit again");
    }
  }

  async function applyRefundAdjustment({ transactionId, adjustment, transaction }) {
    if (!adjustment || adjustment.action !== "refund" || adjustment.type !== "full" || adjustment.status !== "approved" || !adjustment.id) return { changed: false };
    const purchase = await getAdminPurchase(transactionId);
    if (!purchase) throw new Error("Purchase not found for refund");
    const claims = verifyIntent(transaction && transaction.customData && transaction.customData.tinypdfCreditIntent, { ignoreExpiry: true });
    if (!transaction || transaction.id !== transactionId || claims.walletHash !== purchase.wallet_hash) throw new Error("Refund transaction binding mismatch");
    return withTransaction(pool, async (tx) => {
      const current = (await tx.query("SELECT status FROM credit_purchases WHERE transaction_id = $1 FOR UPDATE", [transactionId])).rows[0];
      if (current.status === "refunded") return { changed: false };
      await revokeUnusedCredit(transactionId, tx);
      await tx.query("UPDATE credit_purchases SET status = 'refunded', refund_adjustment_id = $2, updated_at = $3 WHERE transaction_id = $1", [transactionId, adjustment.id, now()]);
      return { changed: true };
    });
  }

  return { createIntent, verifyIntent, settleCompleted, reconcile, getPurchaseStatus, listAccountPurchases, getAdminPurchase, listAdminPurchases, requestRefund, applyRefundAdjustment };
}

module.exports = { createCreditPurchaseService, listAccountPurchaseHistory };
