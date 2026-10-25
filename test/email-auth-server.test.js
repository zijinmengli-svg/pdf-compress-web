"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test("the deployed-style server exposes auth unavailable without blocking compression config", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, "../server-simple.js")], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATABASE_URL: "", RESEND_API_KEY: "", AUTH_FROM_EMAIL: "", ANALYTICS_FILE: path.join(os.tmpdir(), `tinypdf-auth-test-${crypto.randomUUID()}.jsonl`) },
    stdio: "ignore",
  });
  try {
    let config;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { config = await fetch(`http://127.0.0.1:${port}/api/config`, { headers: { Origin: `http://127.0.0.1:${port}`, "User-Agent": "Mozilla/5.0" } }); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.equal(config?.status, 200);
    const auth = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
    assert.equal(auth.status, 200);
    assert.deepEqual(await auth.json(), { available: false, authenticated: false });
  } finally {
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  }
});
