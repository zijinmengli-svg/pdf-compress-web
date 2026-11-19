"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { newDb } = require("pg-mem");
const { createCatalog } = require("../lib/payment/catalog");
const { createOrderService } = require("../lib/payment/order-service");

const products = ["tinypdf", "other"].map(key => ({ key, enabled: true, offers: [{
  key: "credit", enabled: true, quantities: [1, 3, 5, 10], unitsPerQuantity: key === "tinypdf" ? 1 : 2,
  paddle: { sandbox: { productId: `pro_${key}`, priceId: `pri_${key}` } },
}] }));
const alice = { namespace: "tinypdf", id: "account-a", walletHash: "wallet-a" };
const bob = { namespace: "other", id: "account-a", walletHash: "wallet-b" };

async function setup({ refundable = true } = {}) {
  const db = newDb({ noAstCoverageCheck: true });
  const pool = new (db.adapters.createPg().Pool)();
  await pool.query(fs.readFileSync(path.join(__dirname, "../lib/payment/payment-schema.sql"), "utf8"));
  await pool.query(fs.readFileSync(path.join(__dirname, "../lib/payment/refund-audit-v1.sql"), "utf8"));
  await pool.query("CREATE TABLE test_grants (order_id text PRIMARY KEY, product_key text NOT NULL, units integer NOT NULL)");
  const adapter = productKey => ({
    async grant({ orderId, units, subject, tx }) {
      if (subject.walletHash !== (productKey === "tinypdf" ? "wallet-a" : "wallet-b")) throw new Error("Subject context was not preserved");
      const row = (await tx.query("INSERT INTO test_grants(order_id,product_key,units) VALUES ($1,$2,$3) ON CONFLICT (order_id) DO NOTHING RETURNING order_id", [orderId, productKey, units])).rows[0];
      return { granted: Boolean(row) };
    },
    async refundEligibility() { return { eligible: refundable }; },
    async freezeUnused() { return { frozen: true }; },
    async restoreFrozen() { return { restored: true }; },
    async revokeFrozen() { return { revoked: true }; },
    async holdRemaining() { return { frozen: true }; },
  });
  const refunds = [];
  const paddle = {
    async getTransaction(transactionId) { return transactions.get(transactionId); },
    async listRefundAdjustments() { return []; },
    async requestFullRefund({ transactionId, reason }) {
      refunds.push({ transactionId, reason });
      return { id: "adj_one", transactionId, action: "refund", type: "full", status: "pending_approval" };
    },
  };
  const transactions = new Map();
  const service = createOrderService({ pool, catalog: createCatalog({ environment: "sandbox", products }),
    adapters: new Map([["tinypdf", adapter("tinypdf")], ["other", adapter("other")]]),
    intentSecret: "test-order-secret", paddle });
  const remote = ({ prepared, id, productKey = "tinypdf", quantity = 1, status = "completed", priceId, productId, customData } = {}) => ({
    id, status, customData: customData || prepared.customData,
    items: [{ quantity, price: { id: priceId || `pri_${productKey}`, productId: productId || `pro_${productKey}` } }],
    details: { totals: { total: String(quantity * 990), currencyCode: "CNY" } },
  });
  return { pool, service, paddle, transactions, refunds, remote };
}

test("checkout creates a private order bound to one product, offer, and verified subject", async () => {
  const { pool, service } = await setup();
  const prepared = await service.prepareCheckout({ productKey: "tinypdf", offerKey: "credit", quantity: 1, subject: alice });
  assert.match(prepared.orderId, /^ord_/);
  assert.equal(prepared.priceId, "pri_tinypdf");
  assert.equal(prepared.quantity, 1);
  assert.equal((await service.getOrder({ orderId: prepared.orderId, subject: alice })).status, "pending");
  assert.equal(await service.getOrder({ orderId: prepared.orderId, subject: bob }), null);
  await assert.rejects(service.prepareCheckout({ productKey: "tinypdf", offerKey: "credit", quantity: 2, subject: alice }));
  await pool.end();
});

test("settlement credits the actual valid paid quantity once and isolates products", async () => {
  const { pool, service, remote } = await setup();
  const first = await service.prepareCheckout({ productKey: "tinypdf", offerKey: "credit", quantity: 1, subject: alice });
  const second = await service.prepareCheckout({ productKey: "other", offerKey: "credit", quantity: 1, subject: bob });
  assert.equal((await service.settleCompleted(remote({ prepared: first, id: "txn_first", quantity: 3 }))).granted, true);
  assert.equal((await service.settleCompleted(remote({ prepared: first, id: "txn_first", quantity: 3 }))).granted, false);
  await service.settleCompleted(remote({ prepared: second, id: "txn_second", productKey: "other", quantity: 1 }));
  assert.deepEqual((await pool.query("SELECT product_key,units FROM test_grants ORDER BY product_key")).rows,
    [{ product_key: "other", units: 2 }, { product_key: "tinypdf", units: 3 }]);
  assert.equal((await service.getOrder({ orderId: first.orderId, subject: alice })).quantity, 3);
  await pool.end();
});

test("forged, wrong-item, excessive-quantity, or incomplete transactions never grant", async () => {
  const { pool, service, remote } = await setup();
  const prepared = await service.prepareCheckout({ productKey: "tinypdf", offerKey: "credit", quantity: 1, subject: alice });
  for (const transaction of [
    remote({ prepared, id: "txn_forged", customData: { paymentOrderIntent: "forged" } }),
    remote({ prepared, id: "txn_wrong", priceId: "pri_other" }),
    remote({ prepared, id: "txn_large", quantity: 11 }),
    remote({ prepared, id: "txn_incomplete", status: "billed" }),
  ]) await assert.rejects(service.settleCompleted(transaction));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM test_grants")).rows[0].n, 0);
  await pool.end();
});

test("external full refund and rejected refund transition without granting twice", async () => {
  const { pool, service, remote } = await setup();
  const prepared = await service.prepareCheckout({ productKey: "tinypdf", offerKey: "credit", quantity: 1, subject: alice });
  const transaction = remote({ prepared, id: "txn_refund" });
  await service.settleCompleted(transaction);
  const approved = { id: "adj_approved", transactionId: "txn_refund", action: "refund", type: "full", status: "approved" };
  assert.equal((await service.applyAdjustment({ adjustment: approved, transaction })).changed, true);
  assert.equal((await service.applyAdjustment({ adjustment: approved, transaction })).changed, false);
  assert.equal((await service.getOrder({ orderId: prepared.orderId, subject: alice })).status, "refunded");
  await pool.end();
});

test("failed, canceled and unfinished payments leave the order unpaid and cannot be refunded", async () => {
  const { pool, service, remote, transactions, refunds } = await setup();
  try {
    for (const status of ["draft", "ready", "billed", "paid", "past_due", "canceled", "failed"]) {
      const prepared = await service.prepareCheckout({ productKey: "tinypdf", offerKey: "credit", quantity: 3, subject: alice });
      const transaction = remote({ prepared, id: `txn_${status}`, quantity: 3, status });
      transactions.set(transaction.id, transaction);
      await assert.rejects(service.settleCompleted(transaction), /incomplete/);
      const order = await service.getOrder({ orderId: prepared.orderId, subject: alice });
      assert.equal(order.status, "pending");
      assert.equal(order.transactionId, null);
      await assert.rejects(service.requestRefund({ orderId: prepared.orderId, reason: "other", adminActor: "admin-1" }), /not available/);
    }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM test_grants")).rows[0].n, 0);
    assert.equal(refunds.length, 0);
  } finally { await pool.end(); }
});

test("administrator refund freezes an unused order; refusal restores it", async () => {
  const { pool, service, remote, transactions, refunds } = await setup();
  const prepared = await service.prepareCheckout({ productKey: "tinypdf", offerKey: "credit", quantity: 1, subject: alice });
  const transaction = remote({ prepared, id: "txn_admin" });
  transactions.set(transaction.id, transaction);
  await service.settleCompleted(transaction);
  const requested = await service.requestRefund({ orderId: prepared.orderId, reason: "other", adminActor: "admin-1" });
  assert.equal(requested.status, "refund_pending");
  assert.deepEqual(refunds, [{ transactionId: "txn_admin", reason: "other" }]);
  assert.deepEqual((await pool.query("SELECT admin_actor,reason FROM payment_refund_requests")).rows,
    [{ admin_actor: "admin-1", reason: "other" }]);
  assert.equal((await service.getOrder({ orderId: prepared.orderId, subject: alice })).status, "refund_pending");
  await service.applyAdjustment({ transaction, adjustment: { id: "adj_one", transactionId: "txn_admin", action: "refund", type: "full", status: "rejected" } });
  assert.equal((await service.getOrder({ orderId: prepared.orderId, subject: alice })).status, "completed");
  await pool.end();
});

test("partly used bundle cannot be automatically refunded", async () => {
  const { pool, service, remote, transactions, refunds } = await setup({ refundable: false });
  const prepared = await service.prepareCheckout({ productKey: "tinypdf", offerKey: "credit", quantity: 1, subject: alice });
  const transaction = remote({ prepared, id: "txn_used" });
  transactions.set(transaction.id, transaction);
  await service.settleCompleted(transaction);
  await assert.rejects(service.requestRefund({ orderId: prepared.orderId, reason: "other", adminActor: "admin-1" }), /manual/i);
  assert.equal(refunds.length, 0);
  await pool.end();
});

test("a rejected different adjustment cannot restore a pending refund", async () => {
  const { pool, service, remote, transactions } = await setup();
  const prepared = await service.prepareCheckout({ productKey: "tinypdf", offerKey: "credit", quantity: 1, subject: alice });
  const transaction = remote({ prepared, id: "txn_wrong_rejection" });
  transactions.set(transaction.id, transaction);
  await service.settleCompleted(transaction);
  await service.requestRefund({ orderId: prepared.orderId, reason: "other", adminActor: "admin-1" });
  await service.applyAdjustment({ transaction, adjustment: { id: "adj_unrelated", transactionId: transaction.id,
    action: "refund", type: "full", status: "rejected" } });
  assert.equal((await service.getOrder({ orderId: prepared.orderId, subject: alice })).status, "refund_pending");
  await pool.end();
});

test("a late partial adjustment cannot regress a refunded order", async () => {
  const { pool, service, remote } = await setup();
  const prepared = await service.prepareCheckout({ productKey: "tinypdf", offerKey: "credit", quantity: 1, subject: alice });
  const transaction = remote({ prepared, id: "txn_final" });
  await service.settleCompleted(transaction);
  await service.applyAdjustment({ transaction, adjustment: { id: "adj_final", transactionId: transaction.id,
    action: "refund", type: "full", status: "approved" } });
  await service.applyAdjustment({ transaction, adjustment: { id: "adj_old", transactionId: transaction.id,
    action: "refund", type: "partial", status: "pending_approval" } });
  assert.equal((await service.getOrder({ orderId: prepared.orderId, subject: alice })).status, "refunded");
  await pool.end();
});

test("order history includes unpaid orders without exposing another account or product", async () => {
  const { pool, service } = await setup();
  const prepared = await service.prepareCheckout({ productKey: "tinypdf", offerKey: "credit", quantity: 3, subject: alice });
  await service.prepareCheckout({ productKey: "other", offerKey: "credit", quantity: 1, subject: bob });
  await service.prepareCheckout({ productKey: "tinypdf", offerKey: "credit", quantity: 1, subject: { ...alice, id: "someone-else" } });
  const orders = await service.listOrders({ productKey: "tinypdf", subject: alice });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].orderId, prepared.orderId);
  assert.equal(orders[0].status, "pending");
  assert.equal(orders[0].quantity, 3);
  assert.equal(orders[0].walletHash, undefined);
  assert.deepEqual(await service.listOrders({ productKey: "tinypdf", subject: bob }), []);
  await pool.end();
});

test("a refund response timeout cannot overwrite an already confirmed refund", async () => {
  const { pool, service, remote, transactions, paddle } = await setup();
  const prepared = await service.prepareCheckout({ productKey: "tinypdf", offerKey: "credit", quantity: 1, subject: alice });
  const transaction = remote({ prepared, id: "txn_raced" });
  transactions.set(transaction.id, transaction);
  await service.settleCompleted(transaction);
  paddle.requestFullRefund = async () => {
    await service.applyAdjustment({ transaction, adjustment: { id: "adj_raced", transactionId: transaction.id,
      action: "refund", type: "full", status: "approved" } });
    throw new Error("connection lost after provider accepted refund");
  };
  await assert.rejects(service.requestRefund({ orderId: prepared.orderId, reason: "other", adminActor: "admin-1" }));
  assert.equal((await service.getOrder({ orderId: prepared.orderId, subject: alice })).status, "refunded");
  await pool.end();
});
