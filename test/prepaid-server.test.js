"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const { createWebSession } = require("../lib/web-session");

async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test("server mounts payment API closed without payment credentials, leaving compression config open", async () => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, "../server-simple.js")], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATABASE_URL: "", RESEND_API_KEY: "", PADDLE_API_KEY: "", BILLING_ENABLED: "false", WEB_SESSION_SECRET: "isolated-payment-test-secret" },
    stdio: "ignore",
  });
  try {
    let home;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { home = await fetch(`${origin}/`, { headers: { "User-Agent": "Mozilla/5.0", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" } }); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.equal(home?.status, 200);
    const cookie = `tinypdf_web_session=${encodeURIComponent(createWebSession("isolated-payment-test-secret").value)}`;
    const headers = { Cookie: cookie, Origin: origin, "User-Agent": "Mozilla/5.0", "Sec-Fetch-Site": "same-origin" };
    const config = await fetch(`${origin}/api/config`, { headers });
    assert.equal(config.status, 200);
    const webRequestToken = (await config.json()).webRequestToken;
    assert.ok(webRequestToken);
    const payments = await fetch(`${origin}/api/credits/purchases`, { headers });
    assert.equal(payments.status, 503);
    assert.equal((await payments.json()).code, "PAYMENT_UNAVAILABLE");
    const checkout = await fetch(`${origin}/api/credits/purchase-intent`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json", "X-TinyPDF-Web-Token": webRequestToken },
      body: JSON.stringify({ quantity: 1 }),
    });
    assert.equal(checkout.status, 503);
    assert.equal((await checkout.json()).code, "PAYMENT_UNAVAILABLE");
    const webhook = await fetch(`${origin}/api/paddle/webhook`, {
      method: "POST", headers: { "Content-Type": "application/json", "Paddle-Signature": "ts=1;h1=bad" }, body: "{}",
    });
    assert.equal(webhook.status, 503);
    assert.equal((await webhook.json()).code, "PAYMENT_UNAVAILABLE");
  } finally {
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  }
});
