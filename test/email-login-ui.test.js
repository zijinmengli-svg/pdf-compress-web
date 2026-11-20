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
  let logoutDelay = null;
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
    if (url.pathname === "/api/auth/logout") {
      if (logoutDelay) await logoutDelay;
      account = null;
      return respond(200, { authenticated: false });
    }
    return respond(404, { code: "NOT_FOUND" });
  });
  return { page, setError: value => { forcedError = value; }, setLogoutDelay: value => { logoutDelay = value; } };
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
    const confirm = page.getByRole("dialog", { name: "Confirm sign out" });
    await confirm.waitFor();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "My account" }).waitFor();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("dialog", { name: "Confirm sign out" }).getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name: "Sign in with email" }).waitFor();
  } finally { await page.close(); }
});

test("purchase selects the exact pack and waits for server settlement after the checkout event", async () => {
  const { page } = await pageWithAuth({ id: "buyer-1", email: "buyer@example.invalid" });
  try {
    let selected;
    let settled = false;
    await page.addInitScript(() => {
      window.Paddle = {
        Environment: { set() {} },
        Initialize({ eventCallback }) { window.testCheckoutEvent = eventCallback; },
        Checkout: { open(options) { window.testCheckoutOptions = options; } },
      };
    });
    await page.route("**/api/config", route => route.fulfill({ json: {
      webRequestToken: "test-token", payment: { enabled: true, checkout: { environment: "sandbox", clientToken: "test_fixture" } },
    } }));
    await page.route("**/api/credits/purchase-intent", route => {
      selected = route.request().postDataJSON().quantity;
      return route.fulfill({ json: { orderId: "ord_fixture", priceId: "pri_fixture", quantity: selected, customData: { paymentOrderIntent: "test" } } });
    });
    await page.route("**/api/credits/purchase-status?*", route => route.fulfill({ json: {
      orderId: "ord_fixture", status: settled ? "completed" : "pending", quantity: 5, transactionId: settled ? "txn_fixture" : null,
    } }));
    assert.equal((await page.goto(base + "/buy")).status(), 200);
    await page.getByLabel("5 compressions", { exact: true }).check();
    await page.getByText("Mainland China ¥49.50 · USD base $9.95", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Buy 5 compressions" }).click();
    await page.waitForFunction(() => window.testCheckoutOptions);
    assert.equal(selected, 5);
    assert.equal(await page.evaluate(() => window.testCheckoutOptions.items[0].quantity), 5);
    await page.evaluate(() => window.testCheckoutEvent({ name: "checkout.completed" }));
    await page.getByText("Waiting for payment confirmation", { exact: true }).waitFor();
    assert.equal(await page.getByText("Payment confirmed", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Check order status" }).click();
    await page.getByText("Checked: payment is still pending.", { exact: true }).waitFor();
    settled = true;
    await page.getByRole("button", { name: "Check order status" }).click();
    await page.getByText("Payment confirmed", { exact: true }).waitFor();
    await page.reload();
    await page.getByText("Payment confirmed", { exact: true }).waitFor();
    await page.getByText("txn_fixture", { exact: true }).waitFor();
    await page.getByRole("link", { name: "中文" }).click();
    await page.getByText("支付已确认，次数已到账。", { exact: true }).waitFor();
    assert.match(page.url(), /\/zh\/buy\?order=ord_fixture$/);
  } finally { await page.close(); }
});

test("only server-confirmed payment returns to the localized homepage after five seconds, never browser history", async () => {
  for (const zh of [false, true]) {
    const { page } = await pageWithAuth({ id: "buyer-1", email: "buyer@example.invalid" });
    try {
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 1000));
      let status = "pending";
      await page.route("**/api/credits/purchase-status?*", route => route.fulfill({ json: {
        orderId: "ord_return", status, quantity: 5, transactionId: status === "completed" ? "txn_return" : null,
      } }));
      await page.goto(base + "/contact");
      const buyUrl = base + (zh ? "/zh/buy" : "/buy") + "?order=ord_return";
      await page.goto(buyUrl);
      await page.getByText(zh ? "正在等待支付确认" : "Waiting for payment confirmation", { exact: true }).waitFor();
      await page.clock.runFor(6000);
      assert.equal(page.url(), buyUrl, "pending payment must not redirect");
      status = "completed";
      await page.locator("#checkout-refresh").click();
      await page.getByText(zh ? "5秒后自动返回首页" : "Returning to home in 5 seconds", { exact: true }).waitFor({ timeout: 2000 });
      await page.clock.runFor(4000);
      assert.equal(page.url(), buyUrl, "do not leave before five seconds");
      await page.clock.runFor(1000);
      await page.waitForURL(base + (zh ? "/zh/" : "/"));
    } finally { await page.close(); }
  }
});

test("documented payment failures keep checkout retryable; closing permits a new purchase without confirming payment", async () => {
  for (const locale of ["en", "zh"]) {
    const { page } = await pageWithAuth({ id: "buyer-1", email: "buyer@example.invalid" });
    try {
      let orders = 0;
      await page.addInitScript(() => {
        window.Paddle = {
          Environment: { set() {} },
          Initialize({ eventCallback }) { window.testCheckoutEvent = eventCallback; },
          Checkout: { open() {} },
        };
      });
      await page.route("**/api/config", route => route.fulfill({ json: {
        webRequestToken: "test-token", payment: { enabled: true, checkout: { environment: "sandbox", clientToken: "test_fixture" } },
      } }));
      await page.route("**/api/credits/purchase-intent", route => {
        orders++;
        return route.fulfill({ json: { orderId: `ord_retry_${orders}`, priceId: "pri_fixture",
          quantity: route.request().postDataJSON().quantity, customData: { paymentOrderIntent: "test" } } });
      });
      await page.route("**/api/credits/purchase-status?*", route => route.fulfill({ json: {
        orderId: "ord_retry_1", status: "pending", quantity: 1, transactionId: null,
      } }));
      await page.goto(base + (locale === "zh" ? "/zh/buy" : "/buy"));
      const buy = page.locator("#checkout-buy");
      await buy.click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get("order") === "ord_retry_1");
      // Paddle documents dotted event names, not checkout.payment-error.
      for (const name of ["checkout.payment.failed", "checkout.payment.error"]) {
        await page.evaluate(name => window.testCheckoutEvent({ name }), name);
        assert.equal(await page.locator("#checkout-message").textContent(), locale === "zh"
          ? "支付未成功，请在结账页重试。" : "Payment failed. Please retry in checkout.");
        assert.equal(await buy.isDisabled(), true, "do not open a second checkout over the failed attempt");
      }
      await page.evaluate(() => window.testCheckoutEvent({ name: "checkout.closed" }));
      assert.equal(await buy.isEnabled(), true);
      assert.equal(await page.getByText("Payment confirmed", { exact: true }).count(), 0);
      await page.locator("#checkout-refresh").click();
      await page.getByText(locale === "zh" ? "已查询：尚未确认付款。" : "Checked: payment is still pending.", { exact: true }).waitFor();
      await buy.click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get("order") === "ord_retry_2");
      assert.equal(orders, 2);
    } finally { await page.close(); }
  }
});

test("Chinese buy page stays closed when billing is off and requires email login when enabled", async () => {
  const { page } = await pageWithAuth();
  try {
    await page.goto(base + "/zh/buy");
    await page.getByText("暂未开放购买。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "购买 1 次" }).isDisabled(), true);
    assert.equal(await page.locator('script[src*="paddle.com"]').count(), 0);
    await page.route("**/api/config", route => route.fulfill({ json: {
      webRequestToken: "test-token", payment: { enabled: true, checkout: { environment: "sandbox", clientToken: "test_fixture" } },
    } }));
    await page.reload();
    await page.getByLabel("10 次", { exact: true }).check();
    await page.getByText("中国大陆 ¥99.00 · 美元基础价 $19.90", { exact: true }).waitFor();
    await page.getByRole("button", { name: "购买 10 次" }).click();
    await page.getByRole("dialog", { name: "邮箱登录" }).waitFor();
    assert.equal(await page.locator('script[src*="paddle.com"]').count(), 0);
  } finally { await page.close(); }
});

test("payment admin separates unauthorized access, order search and explicitly confirmed refunds", async () => {
  const { page } = await pageWithAuth();
  try {
    await page.goto(base + "/admin-payments");
    await page.getByText("请先登录管理员后台。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("table").count(), 0);
    const orderId = "ord_" + "a".repeat(32);
    let submitted;
    let query;
    await page.route("**/api/admin/payments?*", route => {
      query = new URL(route.request().url()).searchParams.get("q");
      return route.fulfill({ json: { refundsEnabled: true, orders: [{
        orderId, transactionId: "txn_browser_fixture", email: "buyer@example.invalid",
        quantity: 3, amountMinor: 2970, currency: "CNY",
        status: submitted ? "refund_pending" : "completed", createdAt: "2026-11-12T00:00:00Z",
      }] } });
    });
    await page.route("**/api/admin/payments/refund", route => {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 202, json: { status: "refund_pending" } });
    });
    await page.getByLabel("邮箱、订单号或交易编号").fill("buyer@example.invalid");
    await page.getByRole("button", { name: "搜索" }).click();
    await page.getByRole("button", { name: "申请退款", exact: true }).click();
    assert.equal(query, "buyer@example.invalid");
    await page.getByText("txn_browser_fixture", { exact: true }).waitFor();
    await page.getByLabel("退款原因").selectOption("duplicate");
    await page.getByRole("button", { name: "确认申请退款" }).click();
    assert.equal(submitted, undefined);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认申请退款" }).click();
    await page.getByText("退款申请已提交，最终状态以支付平台确认为准。", { exact: true }).waitFor();
    assert.deepEqual(submitted, { orderId, reason: "duplicate", confirm: true });
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByText("退款处理中", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "申请退款", exact: true }).count(), 0);
  } finally { await page.close(); }
});

test("an open homepage automatically refreshes free credits at Beijing 02:00 without changing paid credits", async () => {
  for (const paid of [0, 3]) {
    const { page } = await pageWithAuth(paid ? { id: "buyer-1", email: "buyer@example.invalid" } : null);
    try {
      const before = new Date("2026-11-14T17:59:55.000Z");
      const reset = Date.parse("2026-11-14T18:00:00.000Z");
      await page.clock.install({ time: before });
      await page.clock.pauseAt(new Date(before.getTime() + 500));
      await page.route("**/api/config", route => route.fulfill({ json: {
        webRequestToken: "test-token", payment: { enabled: true, quotaEnabled: true },
      } }));
      let calls = 0;
      await page.route("**/api/credits/balance", async route => {
        calls++;
        const browserNow = await page.evaluate(() => Date.now());
        const free = browserNow >= reset ? 1 : 0;
        await route.fulfill({ json: { available: free + paid, free, paid,
          resetsAt: new Date(reset + free * 86_400_000).toISOString(), timezone: "Asia/Shanghai" } });
      });
      let navigations = 0;
      page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++; });
      await page.goto(base + "/zh/");
      await page.getByText(`剩余 ${paid} 次压缩`, { exact: true }).waitFor();
      await page.getByRole("button", { name: paid ? "我的账户" : "邮箱登录" }).waitFor();
      await page.clock.runFor(4000);
      assert.equal(await page.locator("#credit-balance").textContent(), `剩余 ${paid} 次压缩`);
      const callsBeforeReset = calls;
      await page.clock.runFor(2000);
      await page.getByText(`剩余 ${paid + 1} 次压缩`, { exact: true }).waitFor();
      assert.ok(calls > callsBeforeReset);
      assert.equal(navigations, 1, "balance refreshed without reloading the page");
    } finally { await page.close(); }
  }
});

test("account changes notify the purchase and balance UI without exposing email", async () => {
  const { page } = await pageWithAuth({ id: "account-1", email: "user@example.com" });
  try {
    await page.addInitScript(() => {
      window.accountEvents = [];
      window.addEventListener("tinypdf:auth-changed", event => window.accountEvents.push(event.detail));
    });
    await page.goto(base);
    await page.getByRole("button", { name: "My account" }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.accountEvents.at(-1)), { authenticated: true });
    await page.getByRole("button", { name: "My account" }).click();
    await page.locator("#email-login-logout").click();
    await page.locator("#email-logout-confirm").click();
    await page.getByRole("button", { name: "Sign in with email" }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.accountEvents.at(-1)), { authenticated: false });
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

test("account panel shows identity and secondary-page links without squeezing on mobile", async () => {
  const { page } = await pageWithAuth({ id: "account-1", email: "long.account.address@example.com" });
  try {
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto(`${base}/zh/`);
    await page.getByRole("button", { name: "我的账户" }).click();
    const dialog = page.locator(".email-login-dialog");
    assert.equal(await dialog.getByText("long.account.address@example.com").count(), 1);
    assert.equal(await dialog.getByText("account-1").count(), 1);
    assert.equal(await dialog.getByRole("link", { name: "联系我们" }).getAttribute("href"), "/contact");
    assert.equal(await dialog.getByRole("link", { name: "隐私条款" }).getAttribute("href"), "/privacy");
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.height >= 320, `account dialog too short: ${bounds.height}`);
    assert.ok(bounds.width <= 375, `account dialog too wide: ${bounds.width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await dialog.getByRole("link", { name: "联系我们" }).click();
    await page.getByRole("heading", { name: "Contact", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/contact");
    await page.goto(`${base}/zh/`);
    await page.getByRole("button", { name: "我的账户" }).click();
    await page.getByRole("link", { name: "隐私条款" }).click();
    await page.getByRole("heading", { name: "Privacy Policy" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/privacy");
  } finally { await page.close(); }
});

test("send code stays a compact secondary action while sign in is the primary action", async () => {
  const { page } = await pageWithAuth();
  try {
    await page.goto(base);
    await page.getByRole("button", { name: "Sign in with email" }).click();
    const signIn = page.getByRole("button", { name: "Sign in", exact: true });
    assert.equal(await signIn.isVisible(), true);
    assert.equal(await signIn.isDisabled(), true);
    const panelWidth = await page.locator(".email-login-panel").evaluate(el => el.getBoundingClientRect().width);
    const sendWidth = await page.locator("#email-login-send").evaluate(el => el.getBoundingClientRect().width);
    assert.ok(sendWidth < panelWidth * 0.6, `send code button too wide: ${sendWidth}/${panelWidth}`);
    await page.getByLabel("Email address").fill("user@example.com");
    await page.getByRole("button", { name: "Send code" }).click();
    await page.locator("#email-login-code-section").waitFor({ state: "visible" });
    assert.equal(await signIn.isDisabled(), true);
    await page.getByLabel("6-digit code").fill("123456");
    assert.equal(await signIn.isEnabled(), true);
    const verifyWidth = await page.locator("#email-login-verify").evaluate(el => el.getBoundingClientRect().width);
    assert.ok(verifyWidth > panelWidth * 0.75, `sign in button too narrow: ${verifyWidth}/${panelWidth}`);
  } finally { await page.close(); }
});

test("email and send code share one row without an extra focus border", async () => {
  const { page } = await pageWithAuth();
  try {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(base);
    await page.getByRole("button", { name: "Sign in with email" }).click();
    const email = page.getByLabel("Email address");
    const send = page.getByRole("button", { name: "Send code" });
    const beforeBorder = await email.evaluate(el => getComputedStyle(el).borderColor);
    await email.fill("user@example.com");
    const focused = await email.evaluate(el => ({ border: getComputedStyle(el).borderColor, outlineStyle: getComputedStyle(el).outlineStyle }));
    const inputBox = await email.boundingBox();
    const sendBox = await send.boundingBox();
    const dialogBox = await page.locator(".email-login-dialog").boundingBox();
    assert.ok(inputBox && sendBox && dialogBox);
    assert.ok(sendBox.x > inputBox.x + inputBox.width, "send code should be to the right of email");
    assert.ok(Math.abs((inputBox.y + inputBox.height / 2) - (sendBox.y + sendBox.height / 2)) < 2, "email and send code should align vertically");
    assert.ok(sendBox.x + sendBox.width <= dialogBox.x + dialogBox.width, "send code should fit inside the dialog on mobile");
    assert.equal(focused.border, beforeBorder, "focusing the email should not change its border color");
    assert.equal(focused.outlineStyle, "none", "focusing the email should not add a bright outer ring");
  } finally { await page.close(); }
});

test("login and sign-out dialogs keep circular close controls", async () => {
  for (const account of [null, { id: "account-1", email: "user@example.com" }]) {
    const { page } = await pageWithAuth(account);
    try {
      await page.goto(base);
      await page.getByRole("button", { name: account ? "My account" : "Sign in with email" }).click();
      const close = page.locator("#email-login-close");
      const dimensions = await close.evaluate(el => {
        const box = el.getBoundingClientRect();
        return { width: box.width, height: box.height };
      });
      assert.deepEqual(dimensions, { width: 32, height: 32 });
      if (account) {
        await page.getByRole("button", { name: "Sign out" }).click();
        const confirmationClose = await page.locator("#email-logout-close").evaluate(el => {
          const box = el.getBoundingClientRect();
          return { width: box.width, height: box.height };
        });
        assert.deepEqual(confirmationClose, { width: 32, height: 32 });
      }
    } finally { await page.close(); }
  }
});

test("focused login dialog has no bright outer outline", async () => {
  const { page } = await pageWithAuth();
  try {
    await page.goto(base);
    await page.getByRole("button", { name: "Sign in with email" }).click();
    const dialog = page.locator(".email-login-dialog");
    await page.keyboard.press("Tab");
    await dialog.evaluate(el => el.focus());
    const outline = await dialog.evaluate(el => ({ style: getComputedStyle(el).outlineStyle, focusVisible: el.matches(":focus-visible") }));
    assert.equal(outline.focusVisible, true);
    assert.equal(outline.style, "none");
  } finally { await page.close(); }
});

test("Chinese sign-out confirmation keeps the account after Escape and only exits on confirm", async () => {
  const { page } = await pageWithAuth({ id: "account-1", email: "cn@example.com" });
  try {
    await page.goto(`${base}/zh/`);
    await page.getByRole("button", { name: "我的账户" }).click();
    await page.getByRole("button", { name: "退出登录" }).click();
    const confirm = page.getByRole("dialog", { name: "确认退出登录" });
    await confirm.waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "我的账户" }).waitFor();
    await page.getByRole("button", { name: "退出登录" }).click();
    await page.getByRole("dialog", { name: "确认退出登录" }).getByRole("button", { name: "确认退出" }).click();
    await page.getByRole("button", { name: "邮箱登录" }).waitFor();
  } finally { await page.close(); }
});

test("confirmation cannot be dismissed while sign-out request is running", async () => {
  let release;
  const pendingLogout = new Promise(resolve => { release = resolve; });
  const { page, setLogoutDelay } = await pageWithAuth({ id: "account-1", email: "user@example.com" });
  setLogoutDelay(pendingLogout);
  try {
    await page.goto(base);
    await page.getByRole("button", { name: "My account" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    const confirm = page.getByRole("dialog", { name: "Confirm sign out" });
    await confirm.getByRole("button", { name: "Sign out" }).click();
    await page.keyboard.press("Escape");
    assert.equal(await confirm.isVisible(), true);
    release();
    await page.getByRole("button", { name: "Sign in with email" }).waitFor();
  } finally { release(); await page.close(); }
});
