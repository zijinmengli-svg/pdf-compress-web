"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Readable } = require("node:stream");
const { createPrepaidWebhookRoute } = require("../lib/payment/prepaid-webhook-route");

function request(body, signature = "signed") {
  const req = Readable.from([Buffer.from(body)]);
  req.method = "POST";
  req.headers = { "content-type": "application/json", "paddle-signature": signature };
  return req;
}

function harness(runtime) {
  const route = createPrepaidWebhookRoute({
    getRuntime: () => runtime,
    json: (res, status, payload) => Object.assign(res, { status, payload }),
    sendError: (res, status, code) => Object.assign(res, { status, payload: { code } }),
  });
  return async (req, pathname = "/api/paddle/webhook") => {
    const res = {};
    const handled = await route(req, res, new URL(pathname, "https://tinypdf.cn"));
    return { handled, ...res };
  };
}

test("signed Paddle webhook receives unmodified raw body and acknowledges a duplicate", async () => {
  const calls = [];
  const handle = harness({ webhooks: { acceptWebhook: async input => {
    calls.push(input);
    return { accepted: true, duplicate: calls.length > 1 };
  } } });
  const body = '{ "event_type": "transaction.completed" }\n';
  assert.deepEqual(await handle(request(body)), { handled: true, status: 200, payload: { received: true } });
  assert.deepEqual(await handle(request(body)), { handled: true, status: 200, payload: { received: true } });
  assert.deepEqual(calls, [{ rawBody: body, signature: "signed" }, { rawBody: body, signature: "signed" }]);
});

test("missing or invalid signatures never acknowledge a webhook", async () => {
  let accepted = 0;
  const handle = harness({ webhooks: { acceptWebhook: async () => { accepted++; throw new Error("bad signature"); } } });
  assert.equal((await handle(request("{}", ""))).status, 401);
  assert.equal((await handle(request("{}", "bad"))).status, 401);
  assert.equal(accepted, 1);
});

test("webhook remains closed without payment runtime and rejects oversized bodies", async () => {
  assert.equal((await harness(null)(request("{}"))).status, 503);
  const handle = harness({ webhooks: { acceptWebhook: async () => { throw new Error("unexpected"); } } });
  assert.equal((await handle(request("x".repeat(300_000)))).status, 413);
  assert.equal((await handle(request("{}"), "/api/unknown")).handled, false);
});
