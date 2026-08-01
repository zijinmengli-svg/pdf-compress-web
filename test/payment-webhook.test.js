"use strict";

const assert = require("assert");
const { createWebhookService } = require("../lib/payment/webhook-service");
const { createWebhookWorker } = require("../lib/payment/webhook-worker");

(async () => {
  const receipt = { event_id: "evt_1", event_type: "transaction.completed", transaction_id: "txn_1", processing_attempts: 0 };
  const events = [];
  const repo = {
    accepted: false,
    async enqueueWebhookReceipt(input) { if (this.accepted) return { inserted: false, status: "queued" }; this.accepted = true; this.input = input; return { inserted: true, status: "queued" }; },
    async claimWebhookReceipts() { return this.claimed ? [] : (this.claimed = true, [receipt]); },
    async getOrderForUpdate() { return { id: "order-1", payment_status: "pending", fulfillment_status: "stored", paddle_price_id: "pri_123", paddle_product_id: "pro_123", price_amount_minor: 199, price_currency: "USD" }; },
    async getActiveFileObject() { return { id: "file-1", storage_status: "stored" }; },
    async upsertFinancials(id, data) { this.financials = { id, ...data }; },
    async updateOrderState(_id, patch) { this.orderPatch = patch; },
    async appendOrderEvent(event) { events.push(event); },
    async completeWebhookReceipt() { this.completed = true; },
    async retryWebhookReceipt() { throw new Error("should not retry"); },
  };
  const paddle = {
    async verifyWebhook(raw, signature) { assert.strictEqual(raw, '{"x":1}'); assert.strictEqual(signature, "sig"); return { eventId: "evt_1", eventType: "transaction.completed", data: { id: "txn_1", customData: { tinypdfOrderId: "order-1" } } }; },
    async getTransaction() { return { id: "txn_1", status: "completed", customData: { tinypdfOrderId: "order-1" }, items: [{ quantity: 1, price: { id: "pri_123", productId: "pro_123" }, totals: { subtotal: "199" } }], details: { totals: { subtotal: "199", discount: "0", tax: "0", total: "199", fee: "60", earnings: "139", currencyCode: "USD" } }, payoutTotals: { subtotal: "199", tax: "0", fee: "60", earnings: "139", currencyCode: "USD", exchangeRate: "1" }, adjustedPayoutTotals: { subtotal: "199", tax: "0", fee: "60", earnings: "139", currencyCode: "USD" } }; },
    normalizeCompletedTransaction() { return { transactionCurrency: "USD", customerSubtotalMinor: 199, customerDiscountMinor: 0, customerTaxMinor: 0, customerTotalMinor: 199, paddleFeeMinor: 60, transactionEarningsMinor: 139, payoutCurrency: "USD", payoutSubtotalMinor: 199, payoutTaxMinor: 0, payoutFeeMinor: 60, payoutEarningsMinor: 139, payoutExchangeRate: "1", adjustedPayoutEarningsMinor: 139, payoutCurrencyIsUsd: true }; },
  };
  const service = createWebhookService({ repo, paddle });
  assert.deepStrictEqual(await service.acceptWebhook({ rawBody: '{"x":1}', signature: "sig" }), { accepted: true, duplicate: false, eventType: "transaction.completed" });
  assert.deepStrictEqual(await service.acceptWebhook({ rawBody: '{"x":1}', signature: "sig" }), { accepted: true, duplicate: true, eventType: "transaction.completed" });
  const worker = createWebhookWorker({ repo, paddle, now: () => new Date("2026-08-01T00:00:00Z"), transaction: async (_pool, fn) => fn({}) });
  assert.deepStrictEqual(await worker.processPendingWebhooks(), { processed: 1, failed: 0 });
  assert.deepStrictEqual(repo.orderPatch, { paymentStatus: "paid", fulfillmentStatus: "available", paidAt: new Date("2026-08-01T00:00:00.000Z"), expiresAt: new Date("2026-08-01T01:00:00.000Z") });
  assert.strictEqual(repo.financials.adjustedPayoutEarningsMinor, 139);
  assert.strictEqual(events[0].revenueDeltaMinor, 139);
  console.log("payment webhook tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
