"use strict";

const crypto = require("crypto");
const { withTransaction } = require("./database");

function value(row, camel, snake) { return row && (row[camel] !== undefined ? row[camel] : row[snake]); }

function createWebhookWorker({ repo, pool, paddle, r2, now = () => new Date(), transaction = withTransaction }) {
  async function completed(receipt) {
    const remote = await paddle.getTransaction(value(receipt, "transactionId", "transaction_id"));
    const orderId = remote.customData && remote.customData.tinypdfOrderId;
    if (!orderId || remote.status !== "completed") throw new Error("completed transaction is not bound to a TinyPDF order");
    return transaction(pool, async (tx) => {
      const order = await repo.getOrderForUpdate(orderId, tx);
      if (!order) throw new Error("TinyPDF order not found");
      const item = remote.items && remote.items.length === 1 && remote.items[0];
      if (!item || Number(item.quantity) !== 1 || value(order, "paddlePriceId", "paddle_price_id") !== item.price.id || value(order, "paddleProductId", "paddle_product_id") !== item.price.productId || Number(value(order, "priceAmountMinor", "price_amount_minor")) !== Number(item.totals.subtotal) || String(value(order, "priceCurrency", "price_currency")) !== String(remote.details && remote.details.totals && remote.details.totals.currencyCode || "")) throw new Error("Paddle transaction binding mismatch");
      const file = await repo.getActiveFileObject(orderId, tx);
      if (!file) throw new Error("paid result object is missing");
      const financials = paddle.normalizeCompletedTransaction(remote);
      if (!financials.payoutCurrencyIsUsd) throw new Error("Paddle payout currency is not USD");
      const completedAt = now();
      await repo.upsertFinancials(orderId, { ...financials, reconciledAt: completedAt }, tx);
      await repo.updateOrderState(orderId, { paymentStatus: "paid", fulfillmentStatus: "available", paidAt: completedAt, expiresAt: new Date(completedAt.getTime() + 60 * 60_000) }, tx);
      await repo.appendOrderEvent({ id: crypto.randomUUID(), orderId, eventType: "payment_completed", source: "paddle", providerEventId: value(receipt, "eventId", "event_id"), paymentStatus: "paid", fulfillmentStatus: "available", customerAmountMinor: financials.customerTotalMinor, customerCurrency: financials.transactionCurrency, revenueDeltaMinor: financials.payoutEarningsMinor, revenueCurrency: "USD", occurredAt: completedAt }, tx);
    });
  }

  return {
    async processPendingWebhooks({ limit = 25 } = {}) {
      const receipts = await repo.claimWebhookReceipts(limit, new Date(now().getTime() + 60_000), pool);
      let processed = 0; let failed = 0;
      for (const receipt of receipts) {
        try {
          if (value(receipt, "eventType", "event_type") === "transaction.completed") await completed(receipt);
          await repo.completeWebhookReceipt(value(receipt, "eventId", "event_id"), { message: "processed" }, pool);
          processed += 1;
        } catch (error) {
          const attempts = Number(value(receipt, "processingAttempts", "processing_attempts") || 0) + 1;
          const delay = Math.min(5 * (2 ** Math.max(0, attempts - 1)), 360);
          await repo.retryWebhookReceipt(value(receipt, "eventId", "event_id"), "webhook_reconcile_failed", new Date(now().getTime() + delay * 60_000), pool);
          failed += 1;
        }
      }
      return { processed, failed };
    },
    async queueTransactionReconcile(transactionId) {
      await repo.enqueueWebhookReceipt({ eventId: `reconcile:${transactionId}`, eventType: "transaction.completed", transactionId, payloadHash: "reconcile" }, pool);
    },
  };
}

module.exports = { createWebhookWorker };
