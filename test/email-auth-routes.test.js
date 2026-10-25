"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { newDb } = require("pg-mem");
const { createEmailAuthService } = require("../lib/auth/service");
const { createEmailAuthRoutes } = require("../lib/auth/routes");

async function setup() {
  const pool = new (newDb().adapters.createPg().Pool)();
  const sent = [];
  const service = createEmailAuthService({ pool, secret: "route-test-secret", sendCode: async (email, code) => sent.push({ email, code }) });
  await service.ready();
  let active = service;
  const route = createEmailAuthRoutes({
    getService: () => active,
    website: req => req.allowed,
    readJson: async req => req.body,
    json: (res, status, payload, headers = {}) => { Object.assign(res, { status, payload, headers }); },
    sendError: (res, status, code, message) => { Object.assign(res, { status, payload: { code, message } }); },
    parseCookies: req => req.cookies || {},
  });
  async function request(path, method = "GET", body = {}, extras = {}) {
    const req = { method, body, allowed: true, cookies: {}, headers: { host: "tinypdf.cn", "x-forwarded-proto": "https", "content-type": "application/json" }, ...extras };
    const res = {};
    const handled = await route(req, res, new URL(path, "https://tinypdf.cn"));
    return { handled, ...res };
  }
  return { pool, sent, request, disable: () => { active = null; } };
}

test("auth endpoints reject a missing website request token and expose availability", async () => {
  const ctx = await setup();
  assert.deepEqual((await ctx.request("/api/auth/me")).payload, { available: true, authenticated: false });
  assert.equal((await ctx.request("/api/auth/request-code", "POST", { email: "a@example.com" }, { allowed: false })).status, 403);
  assert.equal(ctx.sent.length, 0);
  assert.equal((await ctx.request("/api/auth/request-code", "POST", { email: "a@example.com" }, { headers: { host: "tinypdf.cn", "content-type": "text/plain" } })).status, 415);
  ctx.disable();
  assert.deepEqual((await ctx.request("/api/auth/me")).payload, { available: false, authenticated: false });
  assert.equal((await ctx.request("/api/auth/request-code", "POST", { email: "a@example.com" })).status, 503);
  assert.equal((await ctx.request("/api/jobs")).handled, false);
  await ctx.pool.end();
});

test("request, verify, me and logout use an HttpOnly Secure session cookie", async () => {
  const ctx = await setup();
  assert.equal((await ctx.request("/api/auth/request-code", "POST", { email: "User@Example.com" })).status, 200);
  const verified = await ctx.request("/api/auth/verify", "POST", { email: "user@example.com", code: ctx.sent[0].code });
  assert.equal(verified.status, 200);
  assert.equal(verified.payload.account.email, "user@example.com");
  assert.match(verified.headers["Set-Cookie"], /^tinypdf_account=[A-Za-z0-9_-]+;/);
  assert.match(verified.headers["Set-Cookie"], /HttpOnly; SameSite=Lax; Secure/);
  assert.doesNotMatch(JSON.stringify(verified.payload), new RegExp(ctx.sent[0].code));
  const token = verified.headers["Set-Cookie"].match(/^tinypdf_account=([^;]+)/)[1];
  assert.equal((await ctx.request("/api/auth/me", "GET", {}, { cookies: { tinypdf_account: token } })).payload.email, "user@example.com");
  const logout = await ctx.request("/api/auth/logout", "POST", {}, { cookies: { tinypdf_account: token } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers["Set-Cookie"], /Max-Age=0/);
  assert.equal((await ctx.request("/api/auth/me", "GET", {}, { cookies: { tinypdf_account: token } })).payload.authenticated, false);
  await ctx.pool.end();
});

test("invalid code and malformed payload have bounded errors", async () => {
  const ctx = await setup();
  assert.equal((await ctx.request("/api/auth/verify", "POST", { email: "a@example.com", code: "111111" })).status, 400);
  assert.equal((await ctx.request("/api/auth/request-code", "POST", { email: "not-an-email" })).status, 400);
  assert.equal((await ctx.request("/api/auth/request-code", "POST", null)).status, 400);
  await ctx.pool.end();
});
