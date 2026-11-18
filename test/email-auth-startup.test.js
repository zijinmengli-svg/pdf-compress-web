"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startEmailAuth } = require("../lib/auth/startup");
test("database/session startup is independent of email delivery and cannot fake a sent code", async () => {
  let ready = false, sender;
  const service = await startEmailAuth({ pool: {}, secret: "isolated", makeSender() { throw new Error("unexpected sender"); },
    makeService({ sendCode }) { sender = sendCode; return { ready: async () => { ready = true; } }; } });
  assert.equal(ready, true);
  assert.equal(service.deliveryAvailable, false);
  await assert.rejects(sender(), /not configured/);
});
test("configured mail startup preserves the real sender", async () => {
  const deliver = async () => {};
  let sender;
  const service = await startEmailAuth({ pool: {}, secret: "isolated", apiKey: "test", from: "test@example.invalid",
    makeSender: () => deliver, makeService: input => { sender = input.sendCode; return { ready: async () => {} }; } });
  assert.equal(sender, deliver);
  assert.equal(service.deliveryAvailable, true);
});
