"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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

test("installed Paddle SDK accepts a locally signed raw payload and rejects tampering", async () => {
  const secret = "isolated-test-secret";
  const body = JSON.stringify({ event_id: "evt_local", event_type: "tinypdf.local_test", data: { id: "txn_local" } });
  const ts = Math.floor(Date.now() / 1000);
  const h1 = crypto.createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex");
  const client = createPaddleClient({ apiKey: "pdl_sdbx_apikey_local", environment: "sandbox", webhookSecret: secret });
  const event = await client.verifyWebhook(body, `ts=${ts};h1=${h1}`);
  assert.equal(event.eventId, "evt_local");
  await assert.rejects(client.verifyWebhook(body.replace("txn_local", "txn_other"), `ts=${ts};h1=${h1}`), /signature/i);
});
