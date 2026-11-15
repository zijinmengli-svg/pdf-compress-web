"use strict";

const crypto = require("node:crypto");
const { withTransaction } = require("./database");

function createOrderService({ pool, catalog, adapters, intentSecret, paddle, now = () => new Date() }) {
  if (!pool || !catalog || !["sandbox", "production"].includes(catalog.environment) ||
      !adapters || typeof adapters.get !== "function" || !String(intentSecret || "") || !paddle) {
    throw new TypeError("Payment order dependencies are required");
  }
  const sign = value => crypto.createHmac("sha256", intentSecret).update(value).digest("base64url");
  function makeIntent(orderId) {
    const payload = Buffer.from(JSON.stringify({ v: 1, orderId, nonce: crypto.randomBytes(16).toString("hex") })).toString("base64url");
    return `${payload}.${sign(payload)}`;
  }
  function verifyIntent(customData) {
    const token = customData && customData.paymentOrderIntent;
    const parts = String(token || "").split(".");
    if (parts.length !== 2) throw new Error("Invalid payment order intent");
    const expected = Buffer.from(sign(parts[0]));
    const received = Buffer.from(parts[1]);
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) throw new Error("Invalid payment order intent");
    let claims;
    try { claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { throw new Error("Invalid payment order intent"); }
    if (claims.v !== 1 || !/^ord_[0-9a-f]{32}$/.test(String(claims.orderId || ""))) throw new Error("Invalid payment order intent");
    return claims.orderId;
  }
  const subjectOf = row => ({ namespace: row.subject_namespace, id: row.subject_id, ...(row.subject_context || {}) });
  function adapterFor(row) {
    const adapter = adapters.get(row.product_key);
    if (!adapter) throw new Error("Product fulfillment adapter unavailable");
    return adapter;
  }
  function parsePaidItem(transaction, order) {
    if (!transaction || !/^txn_[A-Za-z0-9_]+$/.test(String(transaction.id || "")) || transaction.status !== "completed" ||
        !Array.isArray(transaction.items) || transaction.items.length !== 1) throw new Error("Payment transaction is incomplete");
    if (transaction.environment && transaction.environment !== catalog.environment) throw new Error("Payment environment mismatch");
    const item = transaction.items[0];
    const quantity = Number(item && item.quantity);
    const offer = catalog.resolveOffer({ productKey: order.product_key, offerKey: order.offer_key, quantity });
    const totals = transaction.details && transaction.details.totals;
    if (!item.price || item.price.id !== order.price_id || item.price.productId !== order.product_id ||
        offer.priceId !== order.price_id || offer.productId !== order.product_id ||
        !totals || !/^[1-9]\d*$/.test(String(totals.total || "")) || !/^[A-Z]{3}$/.test(String(totals.currencyCode || ""))) {
      throw new Error("Payment order binding mismatch");
    }
    const amount = Number(totals.total);
    if (!Number.isSafeInteger(amount)) throw new Error("Payment total is invalid");
    return { quantity, units: offer.entitlementUnits, amount, currency: totals.currencyCode };
  }
  async function findOrder(db, orderId, lock = false) {
    return (await db.query(`SELECT * FROM payment_orders WHERE order_id=$1${lock ? " FOR UPDATE" : ""}`, [orderId])).rows[0] || null;
  }
  async function prepareCheckout({ productKey, offerKey, quantity, subject }) {
    if (!subject || typeof subject.namespace !== "string" || !subject.namespace || typeof subject.id !== "string" || !subject.id ||
        !adapters.has(productKey)) throw new TypeError("Verified product subject is required");
    const offer = catalog.resolveOffer({ productKey, offerKey, quantity });
    const orderId = `ord_${crypto.randomUUID().replaceAll("-", "")}`;
    const context = { ...subject };
    delete context.namespace;
    delete context.id;
    await pool.query(`INSERT INTO payment_orders(order_id,product_key,offer_key,subject_namespace,subject_id,subject_context,
      provider,environment,price_id,product_id,requested_quantity,entitlement_units,status,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,'paddle',$7,$8,$9,$10,$11,'pending',$12,$12)`,
    [orderId, productKey, offerKey, subject.namespace, subject.id, context, catalog.environment,
      offer.priceId, offer.productId, quantity, offer.entitlementUnits, now()]);
    return { orderId, priceId: offer.priceId, quantity, customData: { paymentOrderIntent: makeIntent(orderId) } };
  }
  function summarize(row) {
    return row ? { orderId: row.order_id, productKey: row.product_key, offerKey: row.offer_key,
      quantity: Number(row.paid_quantity || row.requested_quantity), status: row.status,
      transactionId: row.transaction_id, amountMinor: row.customer_amount_minor == null ? null : Number(row.customer_amount_minor),
      currency: row.customer_currency, createdAt: row.created_at } : null;
  }
  async function listOrders({ productKey, subject, limit = 50 }) {
    if (!productKey || !subject || !subject.namespace || !subject.id) return [];
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError("Invalid history limit");
    const result = await pool.query(`SELECT * FROM payment_orders
      WHERE product_key=$1 AND subject_namespace=$2 AND subject_id=$3 AND environment=$4
      ORDER BY created_at DESC, order_id DESC LIMIT $5`,
    [productKey, subject.namespace, subject.id, catalog.environment, limit]);
    return result.rows.map(summarize);
  }
  async function getOrder({ orderId, subject }) {
    if (!subject || !subject.namespace || !subject.id) return null;
    const row = (await pool.query(`SELECT order_id,product_key,offer_key,requested_quantity,paid_quantity,status,transaction_id,
      customer_amount_minor,customer_currency,created_at FROM payment_orders
      WHERE order_id=$1 AND subject_namespace=$2 AND subject_id=$3`,
    [orderId, subject.namespace, subject.id])).rows[0];
    return summarize(row);
  }
  async function listAdminOrders({ productKey, query, from, to }) {
    const params = [productKey, catalog.environment];
    const conditions = ["o.product_key=$1", "o.environment=$2"];
    if (query) {
      const p = params.push(query);
      conditions.push(`(o.order_id=$${p} OR o.transaction_id=$${p} OR lower(a.email)=$${p})`);
    }
    if (from) conditions.push(`o.created_at >= $${params.push(from)}`);
    if (to) conditions.push(`o.created_at < $${params.push(to)}`);
    const result = await pool.query(`SELECT o.*, a.email AS account_email FROM payment_orders o
      LEFT JOIN auth_accounts a ON o.subject_namespace='tinypdf' AND a.id::text=o.subject_id
      WHERE ${conditions.join(" AND ")} ORDER BY o.created_at DESC, o.order_id DESC LIMIT 100`, params);
    return result.rows.map(row => ({ ...summarize(row), email: row.account_email, adjustmentId: row.refund_adjustment_id }));
  }
  async function settleCompleted(transaction) {
    const orderId = verifyIntent(transaction && transaction.customData);
    return withTransaction(pool, async tx => {
      const order = await findOrder(tx, orderId, true);
      if (!order || order.provider !== "paddle" || order.environment !== catalog.environment) throw new Error("Payment order binding mismatch");
      const paid = parsePaidItem(transaction, order);
      if (order.status !== "pending") {
        if (order.transaction_id !== transaction.id || Number(order.paid_quantity) !== paid.quantity) throw new Error("Payment order already bound elsewhere");
        return { granted: false, orderId, transactionId: transaction.id, status: order.status };
      }
      const adapter = adapterFor(order);
      await tx.query(`UPDATE payment_orders SET transaction_id=$2,paid_quantity=$3,entitlement_units=$4,
        customer_amount_minor=$5,customer_currency=$6,status='completed',updated_at=$7 WHERE order_id=$1`,
      [orderId, transaction.id, paid.quantity, paid.units, paid.amount, paid.currency, now()]);
      const result = await adapter.grant({ orderId, transactionId: transaction.id, subject: subjectOf(order), units: paid.units, tx });
      if (!result || result.granted !== true) throw new Error("Payment fulfillment did not complete");
      return { granted: true, orderId, transactionId: transaction.id, status: "completed" };
    });
  }
  async function requestRefund({ orderId, reason, adminActor, productKey }) {
    if (!String(adminActor || "").trim() || !["duplicate", "service_not_delivered", "other"].includes(reason)) throw new TypeError("Authorized refund actor and reason are required");
    const order = await findOrder(pool, orderId);
    if (!order || order.environment !== catalog.environment || (productKey && order.product_key !== productKey) ||
        order.status !== "completed" || !order.transaction_id) throw new Error("Paid order not available for refund");
    const transaction = await paddle.getTransaction(order.transaction_id);
    if (!transaction || transaction.id !== order.transaction_id || verifyIntent(transaction.customData) !== orderId) throw new Error("Refund transaction binding mismatch");
    parsePaidItem(transaction, order);
    const adjustments = await paddle.listRefundAdjustments(order.transaction_id);
    if (adjustments.some(item => item.action === "refund")) throw new Error("Existing refund needs manual review");
    await withTransaction(pool, async tx => {
      const current = await findOrder(tx, orderId, true);
      if (!current || current.status !== "completed") throw new Error("Refund already requested");
      const adapter = adapterFor(current);
      const input = { orderId, transactionId: current.transaction_id, subject: subjectOf(current), units: Number(current.entitlement_units), tx };
      const eligibility = await adapter.refundEligibility(input);
      if (!eligibility.eligible) throw new Error("Used credits require manual refund review");
      if (!(await adapter.freezeUnused(input)).frozen) throw new Error("Refund credits could not be frozen");
      await tx.query("INSERT INTO payment_refund_requests(id,order_id,admin_actor,reason,created_at) VALUES ($1,$2,$3,$4,$5)",
        [crypto.randomUUID(), orderId, adminActor, reason, now()]);
      await tx.query("UPDATE payment_orders SET status='refund_pending',updated_at=$2 WHERE order_id=$1", [orderId, now()]);
    });
    try {
      const adjustment = await paddle.requestFullRefund({ transactionId: order.transaction_id, reason });
      if (!adjustment || adjustment.transactionId !== order.transaction_id || adjustment.action !== "refund" || adjustment.type !== "full") {
        throw new Error("Refund response is incomplete");
      }
      await pool.query("UPDATE payment_orders SET refund_adjustment_id=$2,updated_at=$3 WHERE order_id=$1", [orderId, adjustment.id, now()]);
      return { status: "refund_pending", orderId, transactionId: order.transaction_id, adjustmentId: adjustment.id };
    } catch {
      await pool.query("UPDATE payment_orders SET status='refund_review',updated_at=$2 WHERE order_id=$1 AND status='refund_pending'", [orderId, now()]);
      throw new Error("Refund outcome requires manual review; do not submit again");
    }
  }
  async function applyAdjustment({ adjustment, transaction }) {
    if (!adjustment || !transaction || !/^txn_[A-Za-z0-9_]+$/.test(String(transaction.id || "")) ||
        adjustment.transactionId !== transaction.id) throw new Error("Refund transaction binding mismatch");
    const orderId = verifyIntent(transaction.customData);
    return withTransaction(pool, async tx => {
      const order = await findOrder(tx, orderId, true);
      if (!order || order.transaction_id !== transaction.id || order.environment !== catalog.environment) throw new Error("Refund order binding mismatch");
      // A completed refund is terminal, even when older notifications arrive later.
      if (order.status === "refunded") return { changed: false };
      const adapter = adapterFor(order);
      const input = { orderId, transactionId: transaction.id, subject: subjectOf(order), units: Number(order.entitlement_units), tx };
      if (adjustment.action !== "refund" || adjustment.type !== "full") {
        await adapter.holdRemaining(input);
        await tx.query("UPDATE payment_orders SET status='refund_review',updated_at=$2 WHERE order_id=$1", [orderId, now()]);
        return { changed: true, status: "refund_review" };
      }
      if (adjustment.status === "rejected") {
        // Never release held credits on an unrelated or uncertain adjustment.
        if (order.status !== "refund_pending" || !order.refund_adjustment_id ||
            order.refund_adjustment_id !== adjustment.id) return { changed: false };
        await adapter.restoreFrozen(input);
        await tx.query("UPDATE payment_orders SET status='completed',updated_at=$2 WHERE order_id=$1", [orderId, now()]);
        return { changed: true, status: "completed" };
      }
      if (adjustment.status !== "approved") return { changed: false };
      if (order.status === "completed") {
        const eligibility = await adapter.refundEligibility(input);
        if (!eligibility.eligible) {
          await adapter.holdRemaining(input);
          await tx.query("UPDATE payment_orders SET status='refund_review',updated_at=$2 WHERE order_id=$1", [orderId, now()]);
          return { changed: true, status: "refund_review" };
        }
        await adapter.freezeUnused(input);
      }
      if (!(await adapter.revokeFrozen(input)).revoked) throw new Error("Refund credits could not be revoked");
      await tx.query("UPDATE payment_orders SET status='refunded',refund_adjustment_id=$2,updated_at=$3 WHERE order_id=$1", [orderId, adjustment.id, now()]);
      return { changed: true, status: "refunded" };
    });
  }
  return { prepareCheckout, getOrder, listOrders, listAdminOrders, settleCompleted, requestRefund, applyAdjustment };
}

module.exports = { createOrderService };
