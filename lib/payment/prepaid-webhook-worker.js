"use strict";

function field(row, camel, snake) { return row && (row[camel] === undefined ? row[snake] : row[camel]); }

function createPrepaidWebhookWorker({ repo, paddle, creditPurchases, pool, now = () => new Date() }) {
  if (!repo || !paddle || !creditPurchases) throw new TypeError("prepaid webhook dependencies are required");

  async function process(receipt) {
    const eventType = field(receipt, "eventType", "event_type");
    const transactionId = field(receipt, "transactionId", "transaction_id");
    if (!/^txn_[A-Za-z0-9_]+$/.test(String(transactionId || ""))) throw new Error("Paddle transaction ID is missing");
    if (eventType === "transaction.completed") {
      const transaction = await paddle.getTransaction(transactionId);
      if (!transaction || transaction.id !== transactionId || !transaction.customData || !transaction.customData.tinypdfCreditIntent) throw new Error("Prepaid transaction binding mismatch");
      await creditPurchases.settleCompleted(transaction);
      return;
    }
    if (eventType === "adjustment.created" || eventType === "adjustment.updated") {
      const adjustmentId = field(receipt, "resourceId", "resource_id");
      const adjustment = (await paddle.listRefundAdjustments(transactionId)).find(item => item.id === adjustmentId);
      if (!adjustment || adjustment.transactionId !== transactionId || adjustment.action !== "refund" || adjustment.type !== "full") throw new Error("Prepaid refund adjustment mismatch");
      const transaction = await paddle.getTransaction(transactionId);
      if (!transaction || transaction.id !== transactionId || !transaction.customData || !transaction.customData.tinypdfCreditIntent) throw new Error("Prepaid refund transaction binding mismatch");
      await creditPurchases.applyRefundAdjustment({ transactionId, adjustment, transaction });
      return;
    }
    throw new Error("Unsupported prepaid webhook event");
  }

  return {
    async processPendingWebhooks({ limit = 25 } = {}) {
      const receipts = await repo.claimWebhookReceipts(limit, new Date(now().getTime() + 60_000), pool);
      let processed = 0; let failed = 0;
      for (const receipt of receipts) {
        const eventId = field(receipt, "eventId", "event_id");
        try {
          await process(receipt);
          await repo.completeWebhookReceipt(eventId, { message: "processed" }, pool);
          processed++;
        } catch {
          const attempts = Number(field(receipt, "processingAttempts", "processing_attempts") || 0) + 1;
          const delayMinutes = Math.min(5 * (2 ** Math.max(0, attempts - 1)), 360);
          await repo.retryWebhookReceipt(eventId, "prepaid_webhook_reconcile_failed", new Date(now().getTime() + delayMinutes * 60_000), pool);
          failed++;
        }
      }
      return { processed, failed };
    },
    async queueTransactionReconcile(transactionId) {
      if (!/^txn_[A-Za-z0-9_]+$/.test(String(transactionId || ""))) throw new TypeError("Paddle transaction ID is required");
      await repo.enqueueWebhookReceipt({ eventId: `reconcile:${transactionId}`, eventType: "transaction.completed", transactionId, payloadHash: "reconcile" }, pool);
    },
  };
}

module.exports = { createPrepaidWebhookWorker };
