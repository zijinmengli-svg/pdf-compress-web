"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { newDb } = require("pg-mem");
const { createEmailAuthService } = require("../lib/auth/service");

async function setup({ failSend = false } = {}) {
  const db = newDb();
  const pool = new (db.adapters.createPg().Pool)();
  const sent = [];
  let time = Date.parse("2026-10-25T01:00:00.000Z");
  const service = createEmailAuthService({
    pool, secret: "test-secret-long-enough-to-sign-values",
    now: () => new Date(time),
    sendCode: async (email, code) => {
      if (failSend) throw new Error("provider down");
      sent.push({ email, code });
    },
  });
  await service.ready();
  return { db, pool, sent, service, advance: ms => { time += ms; } };
}

test("a correct emailed code creates one reusable account and a revocable session", async () => {
  const { db, pool, sent, service, advance } = await setup();
  await service.requestCode({ email: "  User@Example.com ", ip: "192.0.2.1" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, "user@example.com");
  assert.match(sent[0].code, /^\d{6}$/);
  const challenge = db.public.many("SELECT * FROM auth_challenges")[0];
  assert.notEqual(challenge.code_hash, sent[0].code);
  const first = await service.verifyCode({ email: "USER@example.com", code: sent[0].code });
  assert.equal(first.account.email, "user@example.com");
  assert.ok(first.token.length >= 40);
  assert.equal((await service.getSession(first.token)).account.id, first.account.id);
  await assert.rejects(service.verifyCode({ email: "user@example.com", code: sent[0].code }), /Invalid or expired/);
  advance(60_001);
  await service.requestCode({ email: "user@example.com", ip: "192.0.2.1" });
  const second = await service.verifyCode({ email: "user@example.com", code: sent[1].code });
  assert.equal(second.account.id, first.account.id);
  assert.equal(db.public.many("SELECT * FROM auth_accounts").length, 1);
  await service.logout(first.token);
  assert.equal(await service.getSession(first.token), null);
  assert.equal((await service.getSession(second.token)).account.id, first.account.id);
  await pool.end();
});

test("wrong, expired and exhausted codes never create an account", async () => {
  const { db, pool, sent, service, advance } = await setup();
  await service.requestCode({ email: "bad@example.com", ip: "192.0.2.2" });
  for (let i = 0; i < 5; i++) {
    await assert.rejects(service.verifyCode({ email: "bad@example.com", code: "999999" }), /Invalid or expired/);
  }
  await assert.rejects(service.verifyCode({ email: "bad@example.com", code: sent[0].code }), /Invalid or expired/);
  assert.equal(db.public.many("SELECT * FROM auth_accounts").length, 0);
  advance(60_001);
  await service.requestCode({ email: "late@example.com", ip: "192.0.2.2" });
  advance(600_001);
  await assert.rejects(service.verifyCode({ email: "late@example.com", code: sent[1].code }), /Invalid or expired/);
  assert.equal(await service.getSession("forged-token"), null);
  await pool.end();
});

test("resend cooldown and hourly email limit are enforced", async () => {
  const { pool, service, advance } = await setup();
  await service.requestCode({ email: "limit@example.com", ip: "192.0.2.3" });
  await assert.rejects(service.requestCode({ email: "limit@example.com", ip: "192.0.2.3" }), /wait/i);
  for (let i = 0; i < 4; i++) {
    advance(60_001);
    await service.requestCode({ email: "limit@example.com", ip: "192.0.2.3" });
  }
  advance(60_001);
  await assert.rejects(service.requestCode({ email: "limit@example.com", ip: "192.0.2.3" }), /wait/i);
  await pool.end();
});

test("delivery failure removes the challenge and an expired session is not accepted", async () => {
  const broken = await setup({ failSend: true });
  await assert.rejects(broken.service.requestCode({ email: "fail@example.com", ip: "192.0.2.4" }), /could not be sent/);
  assert.equal(broken.db.public.many("SELECT * FROM auth_challenges").length, 0);
  await broken.pool.end();
  const ok = await setup();
  await ok.service.requestCode({ email: "ok@example.com", ip: "192.0.2.5" });
  const result = await ok.service.verifyCode({ email: "ok@example.com", code: ok.sent[0].code });
  ok.advance(30 * 24 * 60 * 60 * 1000 + 1);
  assert.equal(await ok.service.getSession(result.token), null);
  await ok.pool.end();
});
