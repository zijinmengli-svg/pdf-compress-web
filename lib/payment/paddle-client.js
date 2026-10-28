"use strict";

const REFUND_REASONS = Object.freeze({
  duplicate: "Duplicate purchase",
  service_not_delivered: "Service not delivered",
  other: "Customer request",
});

function createPaddleClient(config, sdk = require("@paddle/paddle-node-sdk")) {
  const environment = config && config.environment;
  const apiKey = config && config.apiKey;
  if (!["sandbox", "production"].includes(environment) ||
      typeof apiKey !== "string" ||
      !apiKey.startsWith(environment === "sandbox" ? "pdl_sdbx_apikey_" : "pdl_live_apikey_")) {
    throw new Error("Paddle API key does not match environment");
  }
  if (!config.webhookSecret) throw new Error("Paddle webhook secret is required");
  const paddle = new sdk.Paddle(apiKey, { environment: sdk.Environment[environment] });

  return {
    verifyWebhook(rawBody, signature) {
      if (typeof rawBody !== "string" || !rawBody || typeof signature !== "string" || !signature) {
        throw new Error("Paddle webhook body and signature are required");
      }
      return paddle.webhooks.unmarshal(rawBody, config.webhookSecret, signature);
    },
    getTransaction(transactionId) {
      if (!/^txn_[A-Za-z0-9_]+$/.test(String(transactionId || ""))) throw new TypeError("Invalid Paddle transaction ID");
      return paddle.transactions.get(transactionId);
    },
    requestFullRefund({ transactionId, reason }) {
      if (!/^txn_[A-Za-z0-9_]+$/.test(String(transactionId || ""))) throw new TypeError("Invalid Paddle transaction ID");
      if (!Object.hasOwn(REFUND_REASONS, reason)) throw new TypeError("Invalid refund reason");
      return paddle.adjustments.create({ action: "refund", type: "full", transactionId, reason: REFUND_REASONS[reason] });
    },
    async listRefundAdjustments(transactionId) {
      if (!/^txn_[A-Za-z0-9_]+$/.test(String(transactionId || ""))) throw new TypeError("Invalid Paddle transaction ID");
      const collection = paddle.adjustments.list({ transactionId: [transactionId], action: "refund" });
      const adjustments = [];
      while (collection.hasMore) adjustments.push(...await collection.next());
      return adjustments;
    },
  };
}

module.exports = { createPaddleClient };
