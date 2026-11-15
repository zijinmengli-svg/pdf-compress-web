"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPrepaidRoutes } = require("../lib/payment/prepaid-routes");

function setup(orders, ledger) {
  let enabled = false;
  const calls = [];
  const authService = { getSession: async token => token === "valid-token" ? { account: { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.com" } } : null };
  const route = createPrepaidRoutes({
    getRuntime: () => ({ enabled, authService, orders, ledger, purchases: {
      createIntent: input => { calls.push({ kind: "intent", input }); return { token: "signed-intent", quantity: input.quantity }; },
      getPurchaseStatus: async input => { calls.push({ kind: "status", input }); return { status: "completed" }; },
      listAccountPurchases: async input => { calls.push({ kind: "history", input }); return []; },
    } }),
    resolveWallet: async (_req, sessionToken) => {
      assert.equal(sessionToken, "valid-token");
      return { accountId: "00000000-0000-4000-8000-000000000001", walletHash: "server-owned-wallet" };
    },
    website: req => req.allowed,
    parseCookies: req => req.cookies || {},
    readJson: async req => req.body,
    json: (res, status, payload) => { Object.assign(res, { status, payload }); },
    sendError: (res, status, code) => { Object.assign(res, { status, payload: { code } }); },
  });
  async function request(path, method = "GET", body = {}, extras = {}) {
    const req = { method, body, allowed: true, cookies: {}, headers: { "content-type": "application/json" }, ...extras };
    const res = {};
    const handled = await route(req, res, new URL(path, "https://tinypdf.cn"));
    return { handled, ...res };
  }
  return { request, calls, enable: () => { enabled = true; } };
}

test("new checkout returns a durable order and order lookup uses authenticated identity", async () => {
  const subjectId = "00000000-0000-4000-8000-000000000001";
  const ctx = setup({
    prepareCheckout: async input => {
      assert.equal(input.subject.id, subjectId);
      assert.equal(input.productKey, "tinypdf");
      return { orderId: "ord_saved", quantity: input.quantity };
    },
    getOrder: async input => {
      assert.equal(input.subject.id, subjectId);
      return input.orderId === "ord_saved" ? { orderId: "ord_saved", status: "pending" } : null;
    },
  });
  ctx.enable();
  const cookies = { tinypdf_account: "valid-token" };
  const made = await ctx.request("/api/credits/purchase-intent", "POST", { quantity: 3 }, { cookies });
  assert.equal(made.payload.orderId, "ord_saved");
  const status = await ctx.request("/api/credits/purchase-status?orderId=ord_saved", "GET", {}, { cookies });
  assert.equal(status.status, 200);
  assert.equal(status.payload.status, "pending");
  assert.equal((await ctx.request("/api/credits/purchase-status?orderId=ord_other", "GET", {}, { cookies })).status, 404);
});

test("authenticated balance refreshes the daily allowance and reports its reset time", async () => {
  const ctx = setup(null, {
    ensureDailyFreeCredit: async ({ walletHash }) => {
      assert.equal(walletHash, "server-owned-wallet");
      return { resetsAt: "2026-11-11T18:00:00.000Z" };
    },
    getBalance: async () => ({ available: 4 }),
  });
  const result = await ctx.request("/api/credits/balance", "GET", {}, { cookies: { tinypdf_account: "valid-token" } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload, { available: 4, resetsAt: "2026-11-11T18:00:00.000Z", timezone: "Asia/Shanghai" });
  assert.equal((await ctx.request("/api/credits/balance")).status, 401);
});

test("billing-off blocks new purchases while authenticated history remains available", async () => {
  const ctx = setup();
  const cookies = { tinypdf_account: "valid-token" };
  assert.equal((await ctx.request("/api/credits/purchase-intent", "POST", { quantity: 1 }, { cookies })).status, 503);
  assert.equal((await ctx.request("/api/credits/purchases", "GET", {}, { cookies })).status, 200);
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0].kind, "history");
});

test("history returns durable pending orders even while billing is disabled", async () => {
  const ctx = setup({ listOrders: async input => {
    assert.deepEqual(input, { productKey: "tinypdf", subject: { namespace: "tinypdf", id: "00000000-0000-4000-8000-000000000001" } });
    return [{ orderId: "ord_pending", status: "pending", quantity: 5 }];
  } });
  const result = await ctx.request("/api/credits/purchases", "GET", {}, { cookies: { tinypdf_account: "valid-token" } });
  assert.equal(result.status, 200);
  assert.equal(result.payload.orders[0].orderId, "ord_pending");
  assert.deepEqual(result.payload.purchases, []);
});

test("intent derives account and wallet from signed-in session, never request body", async () => {
  const ctx = setup(); ctx.enable();
  assert.equal((await ctx.request("/api/credits/purchase-intent", "POST", { quantity: 3 })).status, 401);
  assert.equal((await ctx.request("/api/credits/purchase-intent", "POST", { quantity: 2 }, { cookies: { tinypdf_account: "valid-token" } })).status, 400);
  const result = await ctx.request("/api/credits/purchase-intent", "POST", { quantity: 5, accountId: "attacker", walletHash: "guest-wallet" }, { cookies: { tinypdf_account: "valid-token" } });
  assert.equal(result.status, 200);
  assert.deepEqual(ctx.calls[0].input, { accountId: "00000000-0000-4000-8000-000000000001", walletHash: "server-owned-wallet", quantity: 5 });
  assert.equal((await ctx.request("/api/credits/purchase-intent", "POST", { quantity: 10 }, { allowed: false, cookies: { tinypdf_account: "valid-token" } })).status, 403);
});
