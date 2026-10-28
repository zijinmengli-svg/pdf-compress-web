"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPaddleClient } = require("../lib/payment/paddle-client");

test("Paddle adapter selects sandbox and verifies the exact webhook body", async () => {
  const calls = [];
  class Paddle {
    constructor(key, options) { calls.push(["constructor", key, options]);
      this.webhooks = { unmarshal: async (...args) => { calls.push(["unmarshal", ...args]); return { eventId: "evt_test" }; } };
      this.transactions = { get: async id => ({ id }) };
      this.adjustments = { create: async body => body, list: () => ({ next: async () => [] }) };
    }
  }
  const client = createPaddleClient({ apiKey: "pdl_sdbx_apikey_test", environment: "sandbox", webhookSecret: "secret" }, { Paddle, Environment: { sandbox: "sandbox-value", production: "live-value" } });
  assert.deepEqual(await client.verifyWebhook('{"x":1}', "sig"), { eventId: "evt_test" });
  assert.deepEqual(calls, [
    ["constructor", "pdl_sdbx_apikey_test", { environment: "sandbox-value" }],
    ["unmarshal", '{"x":1}', "secret", "sig"],
  ]);
  assert.deepEqual(await client.getTransaction("txn_test"), { id: "txn_test" });
});

test("refund adapter requests a full original-payment refund and enumerates all adjustments", async () => {
  const calls = [];
  class Paddle {
    constructor() {
      this.webhooks = { unmarshal: async () => ({}) };
      this.transactions = { get: async () => ({}) };
      this.adjustments = {
        create: async body => { calls.push(body); return { id: "adj_test", transactionId: body.transactionId, action: body.action, type: body.type }; },
        list: filter => { calls.push(filter); let page = 0; return {
          get hasMore() { return page < 2; },
          next: async () => { page++; return page === 1 ? [{ id: "adj_one" }] : [{ id: "adj_two" }]; },
        }; },
      };
    }
  }
  const client = createPaddleClient({ apiKey: "pdl_live_apikey_test", environment: "production", webhookSecret: "secret" }, { Paddle, Environment: { sandbox: "sandbox-value", production: "live-value" } });
  await client.requestFullRefund({ transactionId: "txn_test", reason: "service_not_delivered" });
  assert.deepEqual(calls[0], { action: "refund", type: "full", transactionId: "txn_test", reason: "Service not delivered" });
  assert.deepEqual(await client.listRefundAdjustments("txn_test"), [{ id: "adj_one" }, { id: "adj_two" }]);
  assert.deepEqual(calls[1], { transactionId: ["txn_test"], action: "refund" });
});

test("Paddle adapter rejects mixed environment credentials", () => {
  assert.throws(() => createPaddleClient({ apiKey: "pdl_live_apikey_test", environment: "sandbox", webhookSecret: "secret" }, { Paddle: class {}, Environment: {} }), /environment/i);
});
