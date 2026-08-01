"use strict";

const assert = require("assert");
const { createPaddleAdapter } = require("../lib/payment/paddle-client");

(async () => {
  const calls = [];
  const previousPrice = {
    id: "pri_old",
    productId: "pro_pdf",
    name: "TinyPDF result",
    description: "One result",
    billingCycle: null,
    taxMode: "location",
    unitPriceOverrides: [
      { countryCodes: ["JP"], unitPrice: { amount: "200", currencyCode: "USD" } },
      { countryCodes: ["CN"], unitPrice: { amount: "888", currencyCode: "CNY" } },
    ],
  };
  const paddle = {
    transactions: {
      async create(body) { calls.push(["transactions.create", body]); return { id: "txn_1", status: "ready", checkout: { url: "https://checkout.example/txn_1" } }; },
      async get(id) { calls.push(["transactions.get", id]); return { id, status: "completed" }; },
      async update(id, body) { calls.push(["transactions.update", id, body]); return { id, status: "canceled" }; },
      list() { return { next: async () => [] }; },
    },
    webhooks: { async unmarshal(body, secret, signature) { calls.push(["unmarshal", body, secret, signature]); if (signature === "bad") throw new Error("invalid"); return { eventId: "evt_1" }; } },
    prices: {
      async get(id) { calls.push(["prices.get", id]); return previousPrice; },
      async create(body) { calls.push(["prices.create", body]); return { ...body, id: "pri_new", billingCycle: null }; },
    },
    adjustments: { async create(body) { calls.push(["adjustments.create", body]); return { id: "adj_1", ...body }; } },
  };
  const adapter = createPaddleAdapter({ apiKey: "pdl_sdbx_key", webhookSecret: "whsec", environment: "sandbox" }, { paddle });
  const checkout = await adapter.createCheckoutTransaction({ orderId: "order-1", attemptKey: "attempt-1", priceId: "pri_123" });
  assert.deepStrictEqual(calls[0], ["transactions.create", {
    items: [{ priceId: "pri_123", quantity: 1 }],
    collectionMode: "automatic",
    customData: { tinypdfOrderId: "order-1", tinypdfAttemptKey: "attempt-1" },
  }]);
  assert.strictEqual(checkout.transactionId, "txn_1");
  assert.deepStrictEqual(await adapter.verifyWebhook('{"event_id":"evt_1"}', "sig"), { eventId: "evt_1" });
  await assert.rejects(adapter.verifyWebhook("{}", "bad"), /invalid/);

  const price = await adapter.createPriceVersion({ productId: "pro_pdf", previousPriceId: "pri_old", usdAmountMinor: 199, cnyAmountMinor: 990 });
  assert.strictEqual(price.id, "pri_new");
  const created = calls.find((call) => call[0] === "prices.create")[1];
  assert.deepStrictEqual(created.unitPrice, { amount: "199", currencyCode: "USD" });
  assert.deepStrictEqual(created.unitPriceOverrides, [
    { countryCodes: ["JP"], unitPrice: { amount: "200", currencyCode: "USD" } },
    { countryCodes: ["CN"], unitPrice: { amount: "990", currencyCode: "CNY" } },
  ]);
  assert.strictEqual(created.billingCycle, null);

  await adapter.requestFullRefund({ transactionId: "txn_1", reason: "service_not_delivered" });
  assert.deepStrictEqual(calls.find((call) => call[0] === "adjustments.create")[1], { action: "refund", transactionId: "txn_1", reason: "service_not_delivered", type: "full" });

  const normalized = adapter.normalizeCompletedTransaction({
    details: { totals: { subtotal: "199", discount: "0", tax: "0", total: "199", fee: "20", earnings: "179", currencyCode: "USD" } },
    payoutTotals: { subtotal: "199", tax: "0", fee: "20", earnings: "179", currencyCode: "USD", exchangeRate: "1" },
    adjustedPayoutTotals: { subtotal: "199", tax: "0", fee: "20", earnings: "179", currencyCode: "USD", exchangeRate: "1", retainedFee: "0" },
  });
  assert.strictEqual(normalized.payoutEarningsMinor, 179);
  assert.strictEqual(normalized.payoutCurrencyIsUsd, true);
  console.log("payment Paddle adapter tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
