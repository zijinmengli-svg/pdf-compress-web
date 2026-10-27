"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createWebhookService } = require("../lib/payment/webhook-service");
const { createPrepaidWebhookWorker } = require("../lib/payment/prepaid-webhook-worker");

test("only verified webhook payloads are queued, and repeated event IDs stay single", async () => {
  let verificationCalls = 0;
  const accepted = new Set();
  const repo = { enqueueWebhookReceipt: async input => {
    const inserted = !accepted.has(input.eventId);
    accepted.add(input.eventId);
    return { inserted };
  } };
  const paddle = { verifyWebhook: async (body, signature) => {
    verificationCalls++;
    if (signature !== "valid") throw new Error("invalid signature");
    return { eventId: "evt_prepaid", eventType: "transaction.completed", data: { id: "txn_prepaid" } };
  } };
  const service = createWebhookService({ repo, paddle });
  await assert.rejects(service.acceptWebhook({ rawBody: "{}", signature: "bad" }), /signature/i);
  assert.equal(accepted.size, 0);
  assert.equal((await service.acceptWebhook({ rawBody: "{}", signature: "valid" })).duplicate, false);
  assert.equal((await service.acceptWebhook({ rawBody: "{}", signature: "valid" })).duplicate, true);
  assert.equal(verificationCalls, 3);
  assert.equal(accepted.size, 1);
});

test("completed transaction and refund adjustment are reconciled once each", async () => {
  const receipts = [
    { event_id: "evt_paid", event_type: "transaction.completed", transaction_id: "txn_prepaid", processing_attempts: 0 },
    { event_id: "evt_refund", event_type: "adjustment.updated", transaction_id: "txn_prepaid", resource_id: "adj_prepaid", processing_attempts: 0 },
  ];
  const calls = [];
  const repo = { claimWebhookReceipts: async () => receipts.splice(0, 1),
    completeWebhookReceipt: async () => {}, retryWebhookReceipt: async () => { throw new Error("unexpected retry"); } };
  const remote = { id: "txn_prepaid", status: "completed", customData: { tinypdfCreditIntent: "signed.intent" } };
  const adjustment = { id: "adj_prepaid", action: "refund", type: "full", transactionId: remote.id, status: "approved" };
  const paddle = { getTransaction: async () => remote, listRefundAdjustments: async () => [adjustment] };
  const creditPurchases = { settleCompleted: async value => { assert.equal(value, remote); calls.push("paid"); },
    applyRefundAdjustment: async input => { assert.equal(input.adjustment, adjustment); calls.push("refunded"); } };
  const worker = createPrepaidWebhookWorker({ repo, paddle, creditPurchases });
  assert.deepEqual(await worker.processPendingWebhooks(), { processed: 1, failed: 0 });
  assert.deepEqual(await worker.processPendingWebhooks(), { processed: 1, failed: 0 });
  assert.deepEqual(calls, ["paid", "refunded"]);
});

test("unbound transaction retries instead of granting credits or marking receipt complete", async () => {
  let completed = 0; let retried = 0; let granted = 0;
  const repo = { claimWebhookReceipts: async () => [{ event_id: "evt_unbound", event_type: "transaction.completed", transaction_id: "txn_unbound", processing_attempts: 0 }],
    completeWebhookReceipt: async () => { completed++; }, retryWebhookReceipt: async () => { retried++; } };
  const paddle = { getTransaction: async () => ({ id: "txn_unbound", status: "completed", customData: {} }) };
  const creditPurchases = { settleCompleted: async () => { granted++; } };
  const worker = createPrepaidWebhookWorker({ repo, paddle, creditPurchases });
  assert.deepEqual(await worker.processPendingWebhooks(), { processed: 0, failed: 1 });
  assert.equal(completed, 0);
  assert.equal(retried, 1);
  assert.equal(granted, 0);
});
