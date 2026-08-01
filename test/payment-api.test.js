"use strict";

const assert = require("assert");
const { createSlidingWindowLimiter } = require("../lib/payment/rate-limit");
const { createCheckoutService } = require("../lib/payment/checkout-service");

(async () => {
  let current = new Date("2026-08-01T00:00:00.000Z");
  const limiter = createSlidingWindowLimiter({ limit: 3, windowMs: 10 * 60_000, secret: "test", now: () => current });
  assert.strictEqual(limiter.allow({ sessionId: "s1", ipPrefix: "1.2.3.4" }), true);
  assert.strictEqual(limiter.allow({ sessionId: "s1", ipPrefix: "1.2.3.4" }), true);
  assert.strictEqual(limiter.allow({ sessionId: "s1", ipPrefix: "1.2.3.4" }), true);
  assert.strictEqual(limiter.allow({ sessionId: "s1", ipPrefix: "1.2.3.4" }), false);

  const calls = [];
  const order = {
    id: "order-1", payment_status: "unpaid", fulfillment_status: "compressed",
    paddle_price_id: "pri_123", compressed_at: current, expires_at: new Date(current.getTime() + 60_000),
  };
  let attempt = null;
  const repo = {
    async getSettings() { return { billing_enabled: true }; },
    async getOrderForUpdate() { return order; },
    async getActiveCheckoutAttempt() { return attempt; },
    async createCheckoutAttempt(input) { attempt = { ...input }; return attempt; },
    async updateCheckoutAttempt(_id, patch) { Object.assign(attempt, patch); return attempt; },
    async updateOrderState(_id, patch) { Object.assign(order, Object.fromEntries(Object.entries(patch).map(([key, value]) => [key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`), value]))); return order; },
    async createFileObject(input) { calls.push(["file", input]); return input; },
    async attachPaddleTransaction(_id, id) { order.paddle_transaction_id = id; return order; },
    async appendOrderEvent(event) { calls.push(["event", event.eventType]); },
  };
  const service = createCheckoutService({
    repo,
    pool: {},
    orderService: { async getAuthorizedOrder(input) { if (input.capabilityToken !== "cap") throw new Error("order is not authorized"); return order; } },
    r2: {
      async putResult() { calls.push(["upload"]); return { bucket: "r2", objectKey: "results/a/b.pdf", sizeBytes: 1, checksumSha256: "a".repeat(64) }; },
      async headResult() { return { sizeBytes: 1, checksumSha256: "a".repeat(64) }; },
      async deleteResult() { calls.push(["delete"]); },
    },
    paddle: { async createCheckoutTransaction() { calls.push(["paddle"]); return { transactionId: "txn_1", checkoutUrl: "", status: "ready" }; } },
    limiter: { allow: () => true },
    now: () => current,
    transaction: async (_pool, fn) => fn({}),
  });
  const prepared = await service.prepareCheckout({ orderId: "order-1", capabilityToken: "cap", sessionClaims: { sid: "s1" }, ipPrefix: "1.2.3.4", job: { filePath: "/tmp/result.pdf", sizeBytes: 1, checksumSha256: "a".repeat(64) } });
  assert.strictEqual(prepared.transactionId, "txn_1");
  assert.deepStrictEqual(calls.slice(0, 2).map((entry) => entry[0]), ["upload", "file"]);
  assert.strictEqual(calls.findIndex((entry) => entry[0] === "upload") < calls.findIndex((entry) => entry[0] === "paddle"), true);
  const repeat = await service.prepareCheckout({ orderId: "order-1", capabilityToken: "cap", sessionClaims: { sid: "s1" }, ipPrefix: "1.2.3.4", job: { filePath: "/tmp/result.pdf", sizeBytes: 1, checksumSha256: "a".repeat(64) } });
  assert.strictEqual(repeat.transactionId, "txn_1");
  assert.strictEqual(calls.filter((entry) => entry[0] === "upload").length, 1);
  await assert.rejects(service.prepareCheckout({ orderId: "order-1", capabilityToken: "wrong", sessionClaims: { sid: "s1" }, ipPrefix: "1.2.3.4", job: {} }), (error) => error.code === "ORDER_ACCESS_DENIED");
  console.log("payment API tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
