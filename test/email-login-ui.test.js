"use strict";

const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { chromium } = require("@playwright/test");

let child, browser, base;
async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(__dirname, "../server-simple.js")], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATABASE_URL: "", RESEND_API_KEY: "", AUTH_FROM_EMAIL: "", ANALYTICS_FILE: path.join(os.tmpdir(), `tinypdf-auth-browser-${crypto.randomUUID()}.jsonl`) },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/api/config`)).ok) break; }
    catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  child?.kill("SIGTERM");
  if (child) await new Promise(resolve => child.once("exit", resolve));
});

async function pageWithAuth(initialAccount = null) {
  const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });
  let account = initialAccount;
  let lastEmail = "";
  let forcedError = null;
  await page.route("**/api/auth/**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const respond = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (req.method() === "GET" && url.pathname === "/api/auth/me") return respond(200, account ? { available: true, authenticated: true, ...account } : { available: true, authenticated: false });
    if (!req.headers()["x-tinypdf-web-token"]) return respond(403, { code: "WEBSITE_SESSION_REQUIRED", message: "Session expired" });
    if (url.pathname === "/api/auth/request-code") {
      if (forcedError) return respond(503, { code: "EMAIL_DELIVERY_FAILED", message: forcedError });
      lastEmail = req.postDataJSON().email;
      return respond(200, { sent: true });
    }
    if (url.pathname === "/api/auth/verify") {
      const body = req.postDataJSON();
      if (body.email !== lastEmail || body.code !== "123456") return respond(400, { code: "INVALID_CODE", message: "Invalid or expired verification code" });
      account = { id: "account-1", email: lastEmail };
      return respond(200, { authenticated: true, account });
    }
    if (url.pathname === "/api/auth/logout") { account = null; return respond(200, { authenticated: false }); }
    return respond(404, { code: "NOT_FOUND" });
  });
  return { page, setError: value => { forcedError = value; } };
}

test("English login stays available before selecting a file and survives refresh", async () => {
  const { page } = await pageWithAuth();
  try {
    await page.goto(base);
    await page.getByRole("button", { name: "Sign in with email" }).click();
    assert.equal(await page.locator("#email-login-send").textContent(), "Send code");
    await page.getByLabel("Email address").fill("user@example.com");
    await page.getByRole("button", { name: "Send code" }).click();
    await page.locator("#email-login-code-section").waitFor({ state: "visible" });
    await page.getByLabel("6-digit code").fill("123456");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "My account" }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "My account" }).waitFor();
    await page.getByRole("button", { name: "My account" }).click();
    assert.equal(await page.getByText("user@example.com").count(), 1);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name: "Sign in with email" }).waitFor();
  } finally { await page.close(); }
});

test("Chinese login persists across language navigation without touching compression", async () => {
  const { page } = await pageWithAuth();
  try {
    await page.goto(`${base}/zh/`);
    await page.getByRole("button", { name: "邮箱登录" }).click();
    await page.getByLabel("邮箱地址").fill("cn@example.com");
    await page.getByRole("button", { name: "发送验证码" }).click();
    await page.locator("#email-login-code-section").waitFor({ state: "visible" });
    await page.getByLabel("6 位验证码").fill("123456");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByRole("button", { name: "我的账户" }).waitFor();
    await page.goto(base);
    await page.getByRole("button", { name: "My account" }).waitFor();
    assert.equal(await page.locator("#pdf").count(), 1);
    assert.equal(await page.locator("#submit-button").isVisible(), true);
  } finally { await page.close(); }
});

test("delivery errors are shown without pretending to sign in", async () => {
  const { page, setError } = await pageWithAuth();
  try {
    setError("Verification email could not be sent");
    await page.goto(base);
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await page.getByLabel("Email address").fill("err@example.com");
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByText("Verification email could not be sent").waitFor();
    assert.equal(await page.getByRole("button", { name: "Sign in with email" }).count(), 1);
  } finally { await page.close(); }
});
