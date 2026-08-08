"use strict";

const assert = require("assert");
const { createOrderService } = require("../lib/payment/order-service");

function createFakeRepo() {
  const orders = new Map();
  const grants = new Map();
  const events = [];
  return {
    orders,
    events,
    async getSettings() {
      return {
        paddle_product_id: "pro_pdf",
        paddle_price_id: "pri_usd_199",
        usd_amount_minor: 199,
        cny_amount_minor: 990,
      };
    },
    async createOrder(input) {
      const row = { ...input, id: input.id };
      orders.set(row.id, row);
      return row;
    },
    async consumeFreeGrant(identity, orderId) {
      if (grants.has(identity)) return false;
      grants.set(identity, orderId);
      return true;
    },
    async restoreFreeGrant(identity, orderId) {
      if (grants.get(identity) === orderId) grants.delete(identity);
    },
    async updateOrderState(orderId, patch) {
      const current = orders.get(orderId);
      const row = { ...current, ...patch };
      orders.set(orderId, row);
      return row;
    },
    async appendOrderEvent(event) { events.push(event); return event; },
    async getOrder(orderId) { return orders.get(orderId) || null; },
  };
}

function successInput(overrides = {}) {
  return {
    sessionId: "s1",
    jobId: "j1",
    originalBytes: 5_000_000,
    targetBytes: 2_000_000,
    resultBytes: 1_900_000,
    reachedTarget: true,
    language: "en",
    country: "US",
    attribution: { source: "Direct", sourceCategory: "direct", referrer: "", utm: {} },
    ...overrides,
  };
}

(async () => {
  const fake = createFakeRepo();
  const fixedNow = new Date("2026-08-01T00:00:00.000Z");
  const service = createOrderService({
    repo: fake,
    identityHashSecret: "identity-secret",
    now: () => fixedNow,
    transaction: async (_pool, fn) => fn({}),
  });

  const first = await service.registerCompressionSuccess(successInput());
  assert.strictEqual(first.paymentRequired, false);
  assert.strictEqual(fake.orders.get(first.orderId).paymentStatus, "not_required");
  assert.strictEqual(fake.orders.get(first.orderId).fulfillmentStatus, "available");
  assert.strictEqual(first.expiresAt.toISOString(), "2026-08-01T01:00:00.000Z");

  const second = await service.registerCompressionSuccess(successInput({ jobId: "j2" }));
  assert.strictEqual(second.paymentRequired, true);
  assert.strictEqual(fake.orders.get(second.orderId).paymentStatus, "unpaid");
  assert.strictEqual(fake.orders.get(second.orderId).paddlePriceId, "pri_usd_199");
  assert.strictEqual(fake.orders.get(second.orderId).source, "Direct");

  await assert.rejects(
    service.registerCompressionSuccess(successInput({ sessionId: "", jobId: "j3" })),
    /session/i,
  );
  await assert.rejects(
    service.getAuthorizedOrder({ orderId: second.orderId, capabilityToken: second.capabilityToken, sessionClaims: { sid: "wrong" } }),
    /authorized/i,
  );
  const authorized = await service.getAuthorizedOrder({ orderId: second.orderId, capabilityToken: second.capabilityToken, sessionClaims: { sid: "s1" } });
  assert.strictEqual(authorized.id, second.orderId);
  assert.strictEqual(second.capabilityToken.includes("?"), false);
  assert.strictEqual(fake.events.filter((event) => event.eventType === "compression_succeeded").length, 2);
  assert.strictEqual(fake.events.filter((event) => event.eventType === "free_grant_consumed").length, 1);
  assert.strictEqual(fake.events.filter((event) => event.eventType === "payment_required").length, 1);

  const ledgerFake = createFakeRepo();
  let ledgerCalls = 0;
  const ledgerService = createOrderService({
    repo: ledgerFake,
    identityHashSecret: "identity-secret",
    creditService: {
      async consumeForCompression(input) {
        ledgerCalls++;
        assert.strictEqual(input.walletHash, "wallet-hash");
        assert.strictEqual(input.legacyIdentityHash, "legacy-identity-hash");
        return ledgerCalls === 1 ? { granted: true, source: "welcome", remaining: 0 } : { granted: false, source: "none", remaining: 0 };
      },
    },
    now: () => fixedNow,
    transaction: async (_pool, fn) => fn({}),
  });
  const ledgerFirst = await ledgerService.registerCompressionSuccess(successInput({ sessionId: "ledger-session", jobId: "ledger-1", walletHash: "wallet-hash", legacyIdentityHash: "legacy-identity-hash" }));
  assert.strictEqual(ledgerFirst.paymentRequired, false);
  assert.strictEqual(ledgerFirst.creditSource, "welcome");
  const ledgerSecond = await ledgerService.registerCompressionSuccess(successInput({ sessionId: "ledger-session", jobId: "ledger-2", walletHash: "wallet-hash", legacyIdentityHash: "legacy-identity-hash" }));
  assert.strictEqual(ledgerSecond.paymentRequired, true);
  assert.strictEqual(ledgerCalls, 2);
  assert.strictEqual(ledgerFake.events.filter((event) => event.eventType === "free_grant_consumed").length, 0);
  console.log("payment order service tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
