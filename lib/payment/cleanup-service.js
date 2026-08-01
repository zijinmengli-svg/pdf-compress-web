"use strict";

const { withTransaction } = require("./database");

function field(row, camel, snake) { return row && (row[camel] !== undefined ? row[camel] : row[snake]); }

function createCleanupService({ repo, pool, r2, paddle, webhookWorker, localJobs, now = () => new Date(), batchSize = 100, transaction = withTransaction }) {
  if (!repo || !r2) throw new TypeError("repo and r2 are required");

  async function processFile(candidate) {
    return transaction(pool, async (tx) => {
      const fileId = field(candidate, "id", "id");
      const orderId = field(candidate, "orderId", "order_id");
      // Maintain the same locking order as the webhook worker: orders first, then files.
      const order = await repo.getOrderForUpdate(orderId, tx);
      const file = repo.getFileObjectForUpdate ? await repo.getFileObjectForUpdate(fileId, tx) : candidate;
      if (!order || !file) return "skipped";
      const paymentStatus = field(order, "paymentStatus", "payment_status");
      const transactionId = field(order, "paddleTransactionId", "paddle_transaction_id");

      if (["unpaid", "pending"].includes(paymentStatus) && transactionId && paddle) {
        const canceled = await paddle.cancelTransaction(transactionId);
        const status = String(canceled && canceled.status || "").toLowerCase();
        if (["paid", "completed"].includes(status)) {
          if (webhookWorker && webhookWorker.queueTransactionReconcile) await webhookWorker.queueTransactionReconcile(transactionId);
          return "reconcile";
        }
      }

      await r2.deleteResult(field(file, "objectKey", "object_key"));
      await repo.markFileDeleted(fileId, now(), tx);
      await repo.updateOrderState(orderId, { fulfillmentStatus: "expired" }, tx);
      return "deleted";
    });
  }

  return {
    async cleanupExpiredFiles() {
      if (localJobs && localJobs.cleanupExpired) await localJobs.cleanupExpired();
      const files = await repo.listExpiredFileObjects(Math.min(Math.max(Number(batchSize) || 100, 1), 100), pool);
      let deleted = 0;
      let failed = 0;
      for (const file of files) {
        try {
          const outcome = await processFile(file);
          if (outcome === "deleted") deleted += 1;
        } catch (error) {
          const attempts = Number(field(file, "deleteAttempts", "delete_attempts") || 0) + 1;
          const delayMinutes = Math.min(5 * (2 ** (attempts - 1)), 360);
          await repo.recordFileDeleteFailure(field(file, "id", "id"), "r2_delete_failed", new Date(now().getTime() + delayMinutes * 60_000), pool);
          failed += 1;
        }
      }
      return { deleted, failed };
    },
  };
}

module.exports = { createCleanupService };
