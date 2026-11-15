// Manual, loopback-only preview. Never loads the project .env or contacts a provider.
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { mkdtemp, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:net";
import { pathToFileURL } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import pgDriver from "pg";
import { chromium } from "@playwright/test";

const modulePath = process.env.TINYPDF_QA_POSTGRES_MODULE;
if (!modulePath?.startsWith("/")) throw new Error("An absolute embedded PostgreSQL module path is required");
const { default: EmbeddedPostgres } = await import(pathToFileURL(modulePath).href);
async function freePort() {
  const socket = createServer().listen(0, "127.0.0.1");
  await once(socket, "listening");
  const { port } = socket.address();
  socket.close();
  await once(socket, "close");
  return port;
}
const dir = await mkdtemp(join(tmpdir(), "tinypdf-manual-qa-"));
const databasePort = await freePort();
const appPort = await freePort();
const origin = `http://127.0.0.1:${appPort}`;
const password = randomBytes(20).toString("hex");
const sessionSecret = randomBytes(32).toString("hex");
const webhookSecret = randomBytes(32).toString("hex");
const adminPassword = randomBytes(20).toString("hex");
const providerFile = join(dir, "provider.json");
const provider = { transactions: {}, adjustments: {} };
const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${databasePort}/tinypdf_test_http`;
const db = new EmbeddedPostgres({ databaseDir: join(dir, "db"), port: databasePort, user: "postgres", password,
  postgresFlags: ["-h", "127.0.0.1"], onLog: () => {}, onError: () => {} });
let started = false, child, pool, browser;
async function persistProvider() {
  await writeFile(providerFile + ".next", JSON.stringify(provider), { mode: 0o600 });
  await rename(providerFile + ".next", providerFile);
}
async function notify(type, data) {
  const body = JSON.stringify({ event_id: `evt_${randomUUID().replaceAll("-", "")}`, event_type: type, data });
  const ts = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", webhookSecret).update(`${ts}:${body}`).digest("hex");
  const response = await fetch(origin + "/api/paddle/webhook", { method: "POST", body,
    headers: { "Content-Type": "application/json", "Paddle-Signature": `ts=${ts};h1=${signature}` } });
  if (!response.ok) throw new Error("Local simulated notification was not accepted");
}
try {
  await db.initialise();
  await db.start();
  started = true;
  await db.createDatabase("tinypdf_test_http");
  await persistProvider();
  child = spawn(process.execPath, ["--require", "./test/payment-local-provider-preload.js", "server-simple.js"], {
    stdio: "ignore",
    env: {
      PATH: process.env.PATH, TMPDIR: dir, HOST: "127.0.0.1", PORT: String(appPort), DATABASE_URL: databaseUrl,
      BILLING_ENABLED: "false", TINYPDF_LOCAL_QUOTA_TEST: "true", TINYPDF_QA_PROVIDER_FILE: providerFile,
      WEB_SESSION_SECRET: sessionSecret, PAYMENT_IDENTITY_HASH_SECRET: sessionSecret, ADMIN_SESSION_SECRET: sessionSecret,
      ADMIN_PASSWORD: adminPassword, PAYMENT_ADMIN_REFUNDS_ENABLED: "true",
      RESEND_API_KEY: "unused-local-fixture", AUTH_FROM_EMAIL: "qa@example.invalid",
      PADDLE_ENVIRONMENT: "sandbox", PADDLE_API_KEY: "pdl_sdbx_apikey_isolated", PADDLE_CLIENT_TOKEN: "test_isolated",
      PADDLE_WEBHOOK_SECRET: webhookSecret, PADDLE_NOTIFICATION_SETTING_ID: "ntfset_isolated",
      PADDLE_PRODUCT_ID: "pro_00000000000000000000000000", PADDLE_PRICE_ID: "pri_00000000000000000000000000",
      ANALYTICS_FILE: join(dir, "analytics.jsonl"),
    },
  });
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    try { ready = Boolean((await (await fetch(origin + "/api/config")).json()).payment.enabled); } catch {}
    if (!ready) await pause(75);
  }
  if (!ready) throw new Error("Local preview did not start");
  pool = new pgDriver.Pool({ connectionString: databaseUrl });
  const accountId = randomUUID();
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHmac("sha256", sessionSecret).update(`session:${token}`).digest("hex");
  await pool.query("INSERT INTO auth_accounts VALUES ($1,'qa@example.invalid',now(),now())", [accountId]);
  await pool.query("INSERT INTO auth_sessions VALUES ($1,$2,now()+interval '8 hours',now())", [tokenHash, accountId]);
  const adminLogin = await fetch(origin + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: adminPassword }) });
  if (!adminLogin.ok) throw new Error("Local admin sign-in failed");
  const adminCookie = adminLogin.headers.get("set-cookie").split(";")[0];
  browser = await chromium.launch({ headless: false, args: ["--start-maximized"] });
  const context = await browser.newContext({ viewport: null, acceptDownloads: true });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addCookies([
    { name: "tinypdf_account", value: token, url: origin, httpOnly: true },
    { name: "tinypdf_admin", value: adminCookie.slice(adminCookie.indexOf("=")+1), url: origin, httpOnly: true },
  ]);
  let writing = false;
  await context.exposeBinding("tinypdfQaPay", async ({ frame }, options) => {
    const url = new URL(frame.url());
    if (url.origin !== origin || !["/buy", "/zh/buy"].includes(url.pathname) || writing) throw new Error("Invalid local payment");
    const item = options.items?.[0];
    if (item?.priceId !== "pri_00000000000000000000000000" || ![1, 3, 5, 10].includes(item.quantity) ||
        typeof options.customData?.paymentOrderIntent !== "string") throw new Error("Invalid local order");
    writing = true;
    try {
      const id = `txn_${randomUUID().replaceAll("-", "")}`;
      const total = String(990 * item.quantity);
      provider.transactions[id] = { id, status: "completed", customData: options.customData,
        items: [{ quantity: item.quantity, price: { id: item.priceId, productId: "pro_00000000000000000000000000" } }],
        details: { totals: { total, currencyCode: "CNY" } } };
      await persistProvider();
      await notify("transaction.completed", { id, status: "completed", items: [], payments: [] });
    } finally { writing = false; }
  });
  await context.addInitScript(({ origin }) => {
    if (location.origin !== origin || window.top !== window) return;
    document.addEventListener("DOMContentLoaded", () => {
      const banner = document.createElement("aside");
      banner.setAttribute("role", "note");
      banner.style.cssText = "position:fixed;bottom:10px;left:10px;z-index:9999;padding:8px 12px;background:#ffe2a3;color:#211a0a;border-radius:8px;font:13px system-ui;pointer-events:none";
      banner.textContent = "本地验收 · 模拟支付 · 不会扣款";
      document.body.append(banner);
    });
    let emit;
    window.Paddle = {
      Environment: { set() {} },
      Initialize({ eventCallback }) { emit = eventCallback; },
      Checkout: {
        open(options) {
          const dialog = document.createElement("dialog");
          const title = document.createElement("h2");
          title.textContent = "模拟收银台（不扣款）";
          const description = document.createElement("p");
          const n = options.items[0].quantity;
          description.textContent = `${n} 次 · 模拟金额 ¥${(n * 9.9).toFixed(2)}`;
          const pay = document.createElement("button");
          pay.textContent = "模拟付款成功";
          const decline = document.createElement("button");
          decline.textContent = "模拟付款失败";
          const cancel = document.createElement("button");
          cancel.textContent = "取消";
          dialog.append(title, description, pay, " ", decline, " ", cancel);
          let completed = false;
          cancel.onclick = () => dialog.close();
          decline.onclick = () => {
            description.textContent = "模拟付款失败；未扣款，可重试或取消。";
            emit({ name: "checkout.payment-error" });
          };
          pay.onclick = async () => {
            pay.disabled = decline.disabled = cancel.disabled = true;
            try {
              await window.tinypdfQaPay(options);
              completed = true;
              emit({ name: "checkout.completed" });
              dialog.close();
            } catch {
              description.textContent = "测试通知未确认。请取消并查询订单。";
              cancel.disabled = false;
            }
          };
          dialog.addEventListener("close", () => {
            dialog.remove();
            if (!completed) emit({ name: "checkout.closed" });
          });
          document.body.append(dialog);
          dialog.showModal();
        },
        close() { document.querySelector("dialog[open]")?.close(); },
      },
    };
  }, { origin });
  const admin = await context.newPage();
  await admin.goto(origin + "/admin-payments");
  const page = await context.newPage();
  await page.goto(origin + "/zh/");
  await page.getByText("剩余 1 次压缩", { exact: true }).waitFor();
  await page.bringToFront();
  console.log(`READY ${origin}/zh/  ${origin}/admin-payments`);
  const disconnected = once(browser, "disconnected");
  const timer = setInterval(async () => {
    if (writing) return;
    writing = true;
    try {
      const rows = (await pool.query("SELECT transaction_id,refund_adjustment_id FROM payment_orders WHERE status='refund_pending' AND refund_adjustment_id IS NOT NULL")).rows;
      for (const row of rows) {
        if (provider.adjustments[row.transaction_id]) continue;
        const adjustment = { id: row.refund_adjustment_id, transactionId: row.transaction_id, action: "refund", type: "full", status: "approved" };
        provider.adjustments[row.transaction_id] = [adjustment];
        await persistProvider();
        try {
          await notify("adjustment.updated", { id: adjustment.id, transaction_id: row.transaction_id,
            action: "refund", type: "full", status: "approved", items: [], totals: { currency_code: "CNY" } });
        } catch { delete provider.adjustments[row.transaction_id]; }
      }
    } catch {} finally { writing = false; }
  }, 1500);
  await disconnected;
  clearInterval(timer);
} catch (error) {
  console.error("Local preview failed:", error?.name === "TimeoutError" ? "browser readiness timed out" : error.message);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null && !child.signalCode) {
    const ended = once(child, "exit");
    child.kill("SIGTERM");
    await ended;
  }
  await pool?.end();
  if (started) await db.stop();
}
