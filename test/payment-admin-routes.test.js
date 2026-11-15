"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createPaymentAdminRoutes } = require("../lib/payment/admin-routes");

test("payment management is admin-only and refund requires an explicit same-origin request", async () => {
  const orderId = "ord_" + "a".repeat(32);
  let refundEnabled = false;
  const calls = [];
  const orders = {
    listAdminOrders: async filters => { calls.push(filters); return [{ orderId }]; },
    requestRefund: async input => { calls.push(input); return { status: "refund_pending", orderId }; },
  };
  const route = createPaymentAdminRoutes({
    getRuntime: () => ({ orders }), isAdmin: req => req.admin, sameOrigin: req => req.origin,
    allowRefunds: () => refundEnabled, readJson: async req => req.body,
    json: (res, status, body) => Object.assign(res, { status, body }),
    sendError: (res, status, code) => Object.assign(res, { status, code }),
  });
  async function send(path, req) {
    const res = {};
    assert.equal(await route({ method: "GET", ...req }, res, new URL(path, "http://test")), true);
    return res;
  }
  const list = "/api/admin/payments";
  const refund = list + "/refund";
  assert.equal((await send(list, {})).status, 401);
  assert.equal((await send(list + "?q=Buyer%40Example.com", { admin: true })).status, 200);
  assert.equal(calls[0].query, "buyer@example.com");
  const post = { method: "POST", admin: true, origin: true, headers: { "content-type": "application/json" },
    body: { orderId, reason: "duplicate", confirm: true } };
  assert.equal((await send(refund, { ...post, origin: false })).status, 403);
  assert.equal((await send(refund, post)).status, 503);
  refundEnabled = true;
  assert.equal((await send(refund, { ...post, body: { ...post.body, confirm: false } })).status, 400);
  assert.equal((await send(refund, post)).status, 202);
  assert.equal(calls[1].adminActor, "site-admin");
  assert.equal(calls.length, 2);
});
