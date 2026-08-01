"use strict";

const crypto = require("crypto");
const { withTransaction } = require("./database");

function value(row, camel, snake) { return row && (row[camel] !== undefined ? row[camel] : row[snake]); }
function paymentError(code, message) { const error = new Error(message || code); error.code = code; return error; }
function isAmbiguous(error) { return error && ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ECONNABORTED"].includes(error.code); }

function createCheckoutService({ repo, pool, orderService, r2, paddle, limiter, now = () => new Date(), transaction = withTransaction }) {
  if (!repo || !orderService || !r2 || !paddle || !limiter) throw new TypeError("checkout dependencies are required");

  async function updateAttempt(attempt, patch) { return repo.updateCheckoutAttempt(value(attempt, "id", "id"), patch); }

  return {
    async prepareCheckout({ orderId, capabilityToken, sessionClaims, ipPrefix, job }) {
      let authorized;
      try { authorized = await orderService.getAuthorizedOrder({ orderId, capabilityToken, sessionClaims }); }
      catch { throw paymentError("ORDER_ACCESS_DENIED", "Order access denied"); }
      if (!limiter.allow({ sessionId: sessionClaims && sessionClaims.sid, ipPrefix })) throw paymentError("RATE_LIMITED", "Too many checkout attempts");
      if (!job || !job.filePath || !Number.isSafeInteger(job.sizeBytes) || !job.checksumSha256) throw paymentError("RESULT_EXPIRED", "Compressed result is no longer available");

      const prepared = await transaction(pool, async (tx) => {
        const settings = await repo.getSettings(tx);
        if (!settings || !(value(settings, "billingEnabled", "billing_enabled"))) throw paymentError("BILLING_UNAVAILABLE", "Billing is currently unavailable");
        const order = await repo.getOrderForUpdate(orderId, tx);
        if (!order) throw paymentError("PAYMENT_NOT_REQUIRED", "This order cannot be paid for");
        const existing = await repo.getActiveCheckoutAttempt(orderId, tx);
        if (existing) {
          const state = value(existing, "state", "state");
          const transactionId = value(existing, "paddleTransactionId", "paddle_transaction_id");
          if (state === "ready" && transactionId) return { existing, order };
          if (["reconcile_pending", "paddle_creating"].includes(state)) throw paymentError("CHECKOUT_RECOVERING", "Checkout is being recovered");
          throw paymentError("CHECKOUT_RECOVERING", "Checkout preparation is in progress");
        }
        if (value(order, "paymentStatus", "payment_status") !== "unpaid") throw paymentError("PAYMENT_NOT_REQUIRED", "This order cannot be paid for");
        const compressedAt = new Date(value(order, "compressedAt", "compressed_at"));
        const expiresAt = new Date(Math.min(compressedAt.getTime() + 2 * 60 * 60_000, now().getTime() + 60 * 60_000));
        const attempt = await repo.createCheckoutAttempt({ id: crypto.randomUUID(), orderId, attemptKey: crypto.randomBytes(24).toString("base64url"), state: "created" }, tx);
        await repo.updateOrderState(orderId, { fulfillmentStatus: "storing", expiresAt }, tx);
        return { attempt, order: { ...order, expires_at: expiresAt } };
      });

      if (prepared.existing) return { orderId, transactionId: value(prepared.existing, "paddleTransactionId", "paddle_transaction_id"), checkoutUrl: "", environment: "" };
      const { attempt, order } = prepared;
      let object;
      try {
        object = await r2.putResult({ orderId, filePath: job.filePath, sizeBytes: job.sizeBytes, checksumSha256: job.checksumSha256 });
        const head = await r2.headResult(object.objectKey);
        if (head.sizeBytes !== object.sizeBytes || head.checksumSha256 !== object.checksumSha256) throw new Error("R2 object verification failed");
        await transaction(pool, async (tx) => {
          await repo.createFileObject({ id: crypto.randomUUID(), orderId, ...object, storedAt: now(), expiresAt: value(order, "expiresAt", "expires_at") }, tx);
          await repo.updateCheckoutAttempt(value(attempt, "id", "id"), { state: "uploaded" }, tx);
        });
      } catch (error) {
        await updateAttempt(attempt, { state: "failed", lastSafeError: "r2_prepare_failed" });
        throw paymentError("RESULT_STORAGE_FAILED", "Unable to prepare the result for checkout");
      }

      try {
        await updateAttempt(attempt, { state: "paddle_creating" });
        const checkout = await paddle.createCheckoutTransaction({ orderId, attemptKey: value(attempt, "attemptKey", "attempt_key"), priceId: value(order, "paddlePriceId", "paddle_price_id") });
        await transaction(pool, async (tx) => {
          await repo.attachPaddleTransaction(orderId, checkout.transactionId, tx);
          await repo.updateCheckoutAttempt(value(attempt, "id", "id"), { state: "ready", paddleTransactionId: checkout.transactionId }, tx);
          await repo.updateOrderState(orderId, { paymentStatus: "pending", fulfillmentStatus: "stored" }, tx);
          await repo.appendOrderEvent({ orderId, eventType: "checkout_ready", source: "server", paymentStatus: "pending", fulfillmentStatus: "stored", customerCurrency: value(order, "priceCurrency", "price_currency"), occurredAt: now() }, tx);
        });
        return { orderId, transactionId: checkout.transactionId, checkoutUrl: checkout.checkoutUrl, environment: "" };
      } catch (error) {
        if (isAmbiguous(error)) {
          await updateAttempt(attempt, { state: "reconcile_pending", lastSafeError: "paddle_create_ambiguous" });
          throw paymentError("CHECKOUT_RECOVERING", "Checkout is being recovered");
        }
        try { await r2.deleteResult(object.objectKey); } catch {}
        await updateAttempt(attempt, { state: "failed", lastSafeError: "paddle_create_failed" });
        throw paymentError("CHECKOUT_UNAVAILABLE", "Unable to create checkout");
      }
    },
  };
}

module.exports = { createCheckoutService, paymentError };
