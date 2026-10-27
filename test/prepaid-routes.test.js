"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPrepaidRoutes } = require("../lib/payment/prepaid-routes");

function setup() {
  let enabled = false;
  const calls = [];
  const authService = { getSession: async token => token === "valid-token" ? { account: { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.com" } } : null };
  const route = createPrepaidRoutes({
    getRuntime: () => ({ enabled, authService, purchases: {
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

test("billing-off blocks new purchases while authenticated history remains available", async () => {
  const ctx = setup();
  const cookies = { tinypdf_account: "valid-token" };
  assert.equal((await ctx.request("/api/credits/purchase-intent", "POST", { quantity: 1 }, { cookies })).status, 503);
  assert.equal((await ctx.request("/api/credits/purchases", "GET", {}, { cookies })).status, 200);
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0].kind, "history");
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
