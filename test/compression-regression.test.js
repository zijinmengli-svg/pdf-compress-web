"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { createWebSession, requestTokenFor } = require("../lib/web-session");

const ROOT = path.join(__dirname, "..");
const PORT = 3900 + Math.floor(Math.random() * 400);
const SESSION_SECRET = "compression-regression-session-secret";

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function makePaddedPdf(bytes) {
  const content = "BT /F1 12 Tf 10 36 Td (TinyPDF) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const document = Buffer.from(pdf, "latin1");
  return Buffer.concat([document, Buffer.alloc(bytes - document.length)]);
}

function multipart(pdf, boundary, targetMB = 1) {
  const opening = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="pdf"; filename="highly-compressible.pdf"\r\nContent-Type: application/pdf\r\n\r\n`);
  const target = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="targetMB"\r\n\r\n${targetMB}\r\n--${boundary}\r\nContent-Disposition: form-data; name="landingLanguage"\r\n\r\nen\r\n--${boundary}--\r\n`);
  return Buffer.concat([opening, pdf, target]);
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => reject(new Error(`server did not start: ${stderr}`)), 15000);
    const check = async () => {
      try {
        const response = await request({ hostname: "127.0.0.1", port: PORT, path: "/api/config", method: "GET" });
        if (response.statusCode === 200) { clearTimeout(timer); resolve(); return; }
      } catch {}
      setTimeout(check, 100);
    };
    check();
  });
}

function waitForFinalState(jobId, accessToken, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: "127.0.0.1",
      port: PORT,
      path: `/api/jobs/${jobId}/events?access=${encodeURIComponent(accessToken)}`,
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
        "Sec-Fetch-Site": "same-origin",
        Referer: `http://127.0.0.1:${PORT}/`,
      },
    }, (res) => {
      let pending = "";
      res.on("data", (chunk) => {
        pending += chunk.toString();
        const events = pending.split("\n\n");
        pending = events.pop();
        for (const event of events) {
          const data = event.split("\n").find((line) => line.startsWith("data: "));
          if (!data) continue;
          const state = JSON.parse(data.slice(6));
          if (["done", "below_range", "error"].includes(state.status)) {
            req.destroy();
            resolve(state);
            return;
          }
        }
      });
    });
    req.on("error", (error) => { if (error.code !== "ECONNRESET") reject(error); });
    const deadline = setTimeout(() => { req.destroy(); reject(new Error("compression timed out")); }, 30000);
    req.on("close", () => clearTimeout(deadline));
  });
}

async function waitForAnalyticsEvent(filePath, jobId, eventName) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const contents = await fsp.readFile(filePath, "utf8").catch(() => "");
    const match = contents.split("\n").filter(Boolean).map(line => JSON.parse(line))
      .find(event => event.event === eventName && event.data?.jobId === jobId);
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`missing ${eventName} analytics for ${jobId}`);
}

(async () => {
  if (process.env.PAYMENT_BROWSER_ACCEPTANCE === "1" && !process.env.PAYMENT_HTTP_TEST_DATABASE_URL) {
    throw new Error("Browser acceptance requires PAYMENT_HTTP_TEST_DATABASE_URL for a disposable local database named tinypdf_test_http");
  }
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tinypdf-regression-"));
  const actualGs = execFileSync("which", ["gs"]).toString().trim();
  const gsTrace = path.join(tempDir, "gs-pdfwrite-runs.txt");
  const gsWrapper = path.join(tempDir, "gs");
  await fsp.writeFile(gsWrapper, '#!/bin/sh\ncase "$*" in *-sDEVICE=pdfwrite*) printf "x\\n" >> "$GS_TRACE_FILE";; esac\nexec "$REAL_GS" "$@"\n', { mode: 0o755 });
  const analyticsFile = path.join(tempDir, "analytics-events.jsonl");
  const quotaDb = process.env.PAYMENT_HTTP_TEST_DATABASE_URL;
  if (quotaDb) {
    const url = new URL(quotaDb);
    assert(url.hostname === "127.0.0.1" && /^\/tinypdf_test_[a-z0-9_]+$/.test(url.pathname) && !url.search);
    if (process.env.PAYMENT_BROWSER_ACCEPTANCE === "1") assert.equal(url.pathname, "/tinypdf_test_http");
  }
  const quotaEnv = quotaDb ? {
    DATABASE_URL: quotaDb, TINYPDF_LOCAL_QUOTA_TEST: "true", PADDLE_ENVIRONMENT: "sandbox", MAX_INFLIGHT_UPLOADS: "12",
    ADMIN_PASSWORD: "isolated-payment-admin-test-password", PAYMENT_ADMIN_REFUNDS_ENABLED: "true",
    PADDLE_API_KEY: "pdl_sdbx_apikey_isolated", PADDLE_CLIENT_TOKEN: "test_isolated",
    PADDLE_WEBHOOK_SECRET: "isolated-webhook-secret", PADDLE_NOTIFICATION_SETTING_ID: "ntfset_isolated",
    PADDLE_PRODUCT_ID: "pro_00000000000000000000000000", PADDLE_PRICE_ID: "pri_00000000000000000000000000",
    PAYMENT_IDENTITY_HASH_SECRET: SESSION_SECRET, RESEND_API_KEY: "isolated-unused", AUTH_FROM_EMAIL: "test@example.invalid",
  } : { DATABASE_URL: "", RESEND_API_KEY: "" };
  const qaProviderFile = path.join(tempDir, "payment-provider-fixture.json");
  const launch = (browserAcceptance = false) => spawn(process.execPath, [
    ...(browserAcceptance ? ["--require", "./test/payment-local-provider-preload.js"] : []), "server-simple.js",
  ], {
    cwd: ROOT,
    env: { ...process.env, ...quotaEnv, ...(browserAcceptance ? { TINYPDF_QA_PROVIDER_FILE: qaProviderFile } : {}),
      BILLING_ENABLED: "false", HOST: "127.0.0.1", PORT: String(PORT), WEB_SESSION_SECRET: SESSION_SECRET, ADMIN_SESSION_SECRET: "admin-session-secret", ANALYTICS_FILE: analyticsFile, PATH: `${tempDir}${path.delimiter}${process.env.PATH}`, REAL_GS: actualGs, GS_TRACE_FILE: gsTrace },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let child = launch();

  try {
    await waitForServer(child);
    const session = createWebSession(SESSION_SECRET);
    let cookie = `tinypdf_web_session=${encodeURIComponent(session.value)}`;
    const origin = `http://127.0.0.1:${PORT}`;
    const baseHeaders = { Cookie: cookie, Origin: origin, Referer: origin + "/", "User-Agent": "Mozilla/5.0",
      "Sec-Fetch-Site": "same-origin", "X-TinyPDF-Web-Token": requestTokenFor(session.value, SESSION_SECRET) };
    async function balance(headers = baseHeaders) {
      const response = await fetch(origin + "/api/credits/balance", { headers });
      return { status: response.status, data: await response.json() };
    }
    if (quotaDb) {
      for (let attempt = 0; attempt < 100 && (await balance()).status !== 200; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal((await balance()).data.free, 1);
      const config = await fetch(origin + "/api/config", { headers: baseHeaders });
      const device = config.headers.getSetCookie().find(value => value.startsWith("tinypdf_quota_device="));
      assert.ok(device, "issue a quota device cookie separate from the website session");
      cookie += `; ${device.split(";")[0]}`;
      baseHeaders.Cookie = cookie;
    }
    const boundary = `----TinyPDF${crypto.randomBytes(8).toString("hex")}`;
    const body = multipart(makePaddedPdf(2 * 1024 * 1024), boundary);
    const response = await request({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/api/jobs",
      method: "POST",
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
        "Sec-Fetch-Site": "same-origin",
        Origin: `http://127.0.0.1:${PORT}`,
        Referer: `http://127.0.0.1:${PORT}/`,
        "X-TinyPDF-Web-Token": requestTokenFor(session.value, SESSION_SECRET),
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
    }, body);
    assert.strictEqual(response.statusCode, 200);
    const job = JSON.parse(response.body.toString("utf8"));
    const finalState = await waitForFinalState(job.id, job.accessToken, cookie);
    assert.strictEqual(finalState.status, "below_range", "a tiny but valid PDF should remain downloadable without counting as an exact-size success");
    assert(finalState.resultBytes > 0 && finalState.resultBytes < 0.9 * 1024 * 1024);
    const download = await request({
      hostname: "127.0.0.1",
      port: PORT,
      path: `/api/jobs/${job.id}/download?access=${encodeURIComponent(job.accessToken)}`,
      method: "GET",
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
        "Sec-Fetch-Site": "same-origin",
        Referer: `http://127.0.0.1:${PORT}/`,
      },
    });
    assert.strictEqual(download.statusCode, 200, "a valid below-range result should be downloadable");
    assert(download.body.subarray(0, 5).equals(Buffer.from("%PDF-")));
    assert.strictEqual(download.body.length, finalState.resultBytes);
    const candidateEvent = await waitForAnalyticsEvent(analyticsFile, job.id, "compress_below_range");
    assert.strictEqual(candidateEvent.data.resultBytes, finalState.resultBytes);
    const analyticsContents = await fsp.readFile(analyticsFile, "utf8");
    assert(!analyticsContents.split("\n").filter(Boolean).map(line => JSON.parse(line))
      .some(event => event.data?.jobId === job.id && ["compress_success", "compress_error"].includes(event.event)),
    "a downloadable below-range result must not be logged as success or error");

    const undersizedBoundary = `----TinyPDF${crypto.randomBytes(8).toString("hex")}`;
    const undersizedBody = multipart(makePaddedPdf(6 * 1024 * 1024), undersizedBoundary, 5);
    const undersizedResponse = await request({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/api/jobs",
      method: "POST",
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
        "Sec-Fetch-Site": "same-origin",
        Origin: `http://127.0.0.1:${PORT}`,
        Referer: `http://127.0.0.1:${PORT}/`,
        "X-TinyPDF-Web-Token": requestTokenFor(session.value, SESSION_SECRET),
        "Content-Type": `multipart/form-data; boundary=${undersizedBoundary}`,
        "Content-Length": undersizedBody.length,
      },
    }, undersizedBody);
    assert.strictEqual(undersizedResponse.statusCode, 200);
    const undersizedJob = JSON.parse(undersizedResponse.body.toString("utf8"));
    const undersizedState = await waitForFinalState(undersizedJob.id, undersizedJob.accessToken, cookie);
    assert.strictEqual(undersizedState.status, "below_range", "a 2 MB result must not count as a successful 5 MB result");
    assert(undersizedState.resultBytes < 4 * 1024 * 1024);

    const smallBoundary = `----TinyPDF${crypto.randomBytes(8).toString("hex")}`;
    const smallBody = multipart(makePaddedPdf(2 * 1024 * 1024), smallBoundary, 1.5);
    const smallResponse = await request({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/api/jobs",
      method: "POST",
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
        "Sec-Fetch-Site": "same-origin",
        Origin: `http://127.0.0.1:${PORT}`,
        Referer: `http://127.0.0.1:${PORT}/`,
        "X-TinyPDF-Web-Token": requestTokenFor(session.value, SESSION_SECRET),
        "Content-Type": `multipart/form-data; boundary=${smallBoundary}`,
        "Content-Length": smallBody.length,
      },
    }, smallBody);
    assert.strictEqual(smallResponse.statusCode, 200);
    const smallJob = JSON.parse(smallResponse.body.toString("utf8"));
    const smallState = await waitForFinalState(smallJob.id, smallJob.accessToken, cookie);
    assert.strictEqual(smallState.status, "below_range", "an output below 90% of a sub-2-MiB target remains available but is not exact-size success");

    const impossibleBoundary = `----TinyPDF${crypto.randomBytes(8).toString("hex")}`;
    const impossibleBody = multipart(makePaddedPdf(2 * 1024 * 1024), impossibleBoundary, 0.0001);
    const impossibleResponse = await request({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/api/jobs",
      method: "POST",
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
        "Sec-Fetch-Site": "same-origin",
        Origin: `http://127.0.0.1:${PORT}`,
        Referer: `http://127.0.0.1:${PORT}/`,
        "X-TinyPDF-Web-Token": requestTokenFor(session.value, SESSION_SECRET),
        "Content-Type": `multipart/form-data; boundary=${impossibleBoundary}`,
        "Content-Length": impossibleBody.length,
      },
    }, impossibleBody);
    assert.strictEqual(impossibleResponse.statusCode, 200);
    const impossibleJob = JSON.parse(impossibleResponse.body.toString("utf8"));
    const impossibleState = await waitForFinalState(impossibleJob.id, impossibleJob.accessToken, cookie);
    assert.strictEqual(impossibleState.status, "error", "a result above the requested maximum must not count as success");
    assert.strictEqual(impossibleState.errorCode, "TARGET_RANGE_TOO_LARGE");
    if (quotaDb) {
      assert.equal((await balance()).data.free, 1, "below-range and failed jobs restore the free credit");
      const pdf = makePaddedPdf(2 * 1024 * 1024);
      const target = finalState.resultBytes * 1.04 / (1024 * 1024);
      async function submit(headers = baseHeaders) {
        const form = new FormData();
        form.append("pdf", new Blob([pdf], { type: "application/pdf" }), "highly-compressible.pdf");
        form.append("targetMB", String(target));
        const response = await fetch(origin + "/api/jobs", { method: "POST", headers, body: form });
        return { status: response.status, job: await response.json() };
      }
      const first = await submit();
      assert.equal(first.status, 200);
      const done = await waitForFinalState(first.job.id, first.job.accessToken, cookie);
      assert.equal(done.status, "done", JSON.stringify(done));
      assert(done.resultBytes < pdf.length);
      assert.equal((await balance()).data.available, 0);
      assert.equal((await submit()).status, 402);
      const newSession = createWebSession(SESSION_SECRET);
      const rotated = { ...baseHeaders,
        Cookie: cookie.replace(encodeURIComponent(session.value), encodeURIComponent(newSession.value)) };
      assert.equal((await balance(rotated)).data.available, 0, "a new website session must not restore today's free credit");
      const { Pool } = require("pg");
      const { createPrepaidRuntime } = require("../lib/payment/prepaid-runtime");
      const pool = new Pool({ connectionString: quotaDb });
      try {
        const id = crypto.randomUUID();
        const token = crypto.randomBytes(24).toString("hex");
        const hmac = value => crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
        await pool.query("INSERT INTO auth_accounts VALUES ($1,$2,now(),now())", [id, `${id}@example.invalid`]);
        await pool.query("INSERT INTO auth_sessions VALUES ($1,$2,now()+interval '1 hour',now())", [hmac(`session:${token}`), id]);
        const signedCookie = `${cookie}; tinypdf_account=${token}`;
        const signedHeaders = { ...baseHeaders, Cookie: signedCookie };
        assert.equal((await balance(signedHeaders)).data.available, 0, "signing in must not issue a second free credit");
        const transactions = new Map();
        let providerRefundCalls = 0;
        const paddle = {
          getTransaction: async transactionId => transactions.get(transactionId),
          listRefundAdjustments: async () => [],
          requestFullRefund: async ({ transactionId }) => {
            providerRefundCalls++;
            return { id: `adj_${transactionId}`, transactionId, action: "refund", type: "full", status: "pending_approval" };
          },
        };
        const runtime = createPrepaidRuntime({ pool, authService: { getSession: async () => ({ account: { id } }) },
          config: { environment: "sandbox", productId: quotaEnv.PADDLE_PRODUCT_ID, priceId: quotaEnv.PADDLE_PRICE_ID,
            webSessionSecret: SESSION_SECRET, identityHashSecret: SESSION_SECRET }, paddle });
        const wallet = await runtime.resolveWallet({ sessionToken: token, guestWalletHash: "test-only" });
        const subject = { namespace: "tinypdf", id, walletHash: wallet.walletHash };
        const prepared = await runtime.orders.prepareCheckout({ productKey: "tinypdf", offerKey: "compression-credit", quantity: 1, subject });
        const transaction = { id: `txn_${token}`, status: "completed", customData: prepared.customData,
          items: [{ quantity: 1, price: { id: quotaEnv.PADDLE_PRICE_ID, productId: quotaEnv.PADDLE_PRODUCT_ID } }],
          details: { totals: { total: "990", currencyCode: "CNY" } } };
        transactions.set(transaction.id, transaction);
        const notifications = await Promise.all(Array.from({ length: 12 }, () => runtime.orders.settleCompleted(transaction)));
        assert.equal(notifications.filter(result => result.granted).length, 1);
        assert.equal((await balance(signedHeaders)).data.paid, 1);
        const concurrent = await Promise.all(Array.from({ length: 12 }, () => submit(signedHeaders)));
        const accepted = concurrent.filter(result => result.status === 200);
        assert.equal(accepted.length, 1);
        assert.equal(concurrent.filter(result => result.status === 402).length, 11);
        const paid = accepted[0].job;
        assert.equal((await waitForFinalState(paid.id, paid.accessToken, signedCookie)).status, "done");
        assert.equal((await balance(signedHeaders)).data.available, 0);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM reward_ledger_events WHERE event_type='spent' AND job_id=$1", [paid.id])).rows[0].n, 1);
        const download = await fetch(`${origin}/api/jobs/${paid.id}/download?access=${encodeURIComponent(paid.accessToken)}`, { headers: signedHeaders });
        assert.equal(download.status, 200);
        assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
        for (const quantity of [3, 5, 10]) {
          const order = await runtime.orders.prepareCheckout({ productKey: "tinypdf", offerKey: "compression-credit", quantity, subject });
          const simulated = { ...transaction, id: `txn_${token}_${quantity}`, customData: order.customData,
            items: [{ ...transaction.items[0], quantity }], details: { totals: { total: String(199 * quantity), currencyCode: "USD" } } };
          transactions.set(simulated.id, simulated);
          await runtime.orders.settleCompleted(simulated);
          assert.equal((await balance(signedHeaders)).data.paid, quantity);
          const before = providerRefundCalls;
          const requests = await Promise.allSettled(Array.from({ length: 12 }, () =>
            runtime.orders.requestRefund({ orderId: order.orderId, reason: "other", adminActor: "local-qa" })));
          assert.equal(requests.filter(result => result.status === "fulfilled").length, 1);
          assert.equal(providerRefundCalls - before, 1);
          const refund = requests.find(result => result.status === "fulfilled").value;
          assert.equal(refund.status, "refund_pending");
          assert.equal((await balance(signedHeaders)).data.paid, 0);
          const adjustment = { id: `adj_${simulated.id}`, transactionId: simulated.id, type: "full", action: "refund", status: "approved" };
          await runtime.orders.applyAdjustment({ adjustment, transaction: simulated });
          assert.equal((await runtime.orders.getOrder({ orderId: order.orderId, subject })).status, "refunded");
          assert.equal((await balance(signedHeaders)).data.paid, 0);
        }
        console.log("PASS: Ghostscript upload/download, no-credit block, login continuity, concurrent simulated payment settlement and paid compression");
        console.log("PASS: 1/3/5/10 packs, unused simulated refunds, and account balance synchronization");
        assert.equal((await fetch(origin + "/api/admin/payments", { headers: signedHeaders })).status, 401);
        const adminLogin = await fetch(origin + "/api/admin/login", { method: "POST",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: quotaEnv.ADMIN_PASSWORD }) });
        assert.equal(adminLogin.status, 200);
        const adminHeaders = { ...baseHeaders, Cookie: adminLogin.headers.getSetCookie()[0].split(";")[0] };
        const filtered = await fetch(origin + "/api/admin/payments?q=" + encodeURIComponent(`${id}@example.invalid`), { headers: adminHeaders });
        assert.equal(filtered.status, 200);
        const listed = await filtered.json();
        assert.equal(listed.refundsEnabled, false, "billing gate must override the refund switch");
        assert.equal(listed.orders.length, 4);
        assert.equal(listed.orders.filter(order => order.status === "refunded").length, 3);
        const byTransaction = await fetch(origin + "/api/admin/payments?q=" + transaction.id, { headers: adminHeaders });
        assert.deepEqual((await byTransaction.json()).orders.map(order => order.orderId), [prepared.orderId]);
        const orderDay = new Date(new Date(listed.orders[0].createdAt).getTime() + 28_800_000).toISOString().slice(0, 10);
        const byDate = await fetch(`${origin}/api/admin/payments?from=${orderDay}&to=${orderDay}`, { headers: adminHeaders });
        assert.ok((await byDate.json()).orders.some(order => order.orderId === listed.orders[0].orderId));
        assert.equal((await fetch(origin + "/api/admin/payments?from=2026-02-31", { headers: adminHeaders })).status, 400);
        const deniedRefund = await fetch(origin + "/api/admin/payments/refund", { method: "POST",
          headers: { ...adminHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: prepared.orderId, reason: "other", confirm: true }) });
        assert.equal(deniedRefund.status, 503);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM payment_refund_requests")).rows[0].n, 3);
        console.log("PASS: authenticated admin order search, actual PostgreSQL refund audit, and closed refund gate");
        const fresh = { ...transaction, id: `txn_${token}_restart` };
        const order = await runtime.orders.prepareCheckout({ productKey: "tinypdf", offerKey: "compression-credit", quantity: 1, subject });
        fresh.customData = order.customData;
        await runtime.orders.settleCompleted(fresh);
        assert.equal((await runtime.ledger.reserveJob({
          walletHash: wallet.walletHash, jobId: "abandoned-restart", purchasedOnly: true,
          leaseExpiresAt: new Date(Date.now() + 60_000),
        })).reserved, true);
        assert.equal((await balance(signedHeaders)).data.available, 0);
        const exited = new Promise(resolve => child.once("exit", resolve));
        child.kill("SIGKILL");
        await exited;
        // Advance just this fixture's persisted deadline instead of waiting for the real job budget.
        await pool.query("UPDATE prepaid_job_reservations SET lease_expires_at=now()-interval '1 second' WHERE job_id=$1", ["abandoned-restart"]);
        child = launch();
        await waitForServer(child);
        for (let attempt = 0; attempt < 100 && (await balance(signedHeaders)).data.paid !== 1; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.equal((await balance(signedHeaders)).data.paid, 1);
        assert.equal((await pool.query("SELECT status FROM prepaid_job_reservations WHERE job_id=$1", [paid.id])).rows[0].status, "spent");
        console.log("PASS: forced server restart recovers an expired paid reservation without refunding a successful job");
        if (process.env.PAYMENT_BROWSER_ACCEPTANCE === "1") {
          const { chromium } = require("@playwright/test");
          const providerFixture = { transactions: {}, adjustments: {} };
          await fsp.writeFile(qaProviderFile, JSON.stringify(providerFixture), { mode: 0o600 });
          const closed = new Promise(resolve => child.once("exit", resolve));
          child.kill("SIGTERM");
          await closed;
          child = launch(true);
          await waitForServer(child);
          for (let attempt = 0; attempt < 100; attempt++) {
            const ready = await fetch(origin + "/api/config", { headers: baseHeaders });
            if ((await ready.json()).payment.enabled) break;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          const browser = await chromium.launch();
          try {
            const context = await browser.newContext({ userAgent: "Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36" });
            await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
            await context.addCookies([
              ...signedCookie.split("; ").map(pair => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i+1), url: origin }; }),
              { name: adminHeaders.Cookie.split("=")[0], value: adminHeaders.Cookie.slice(adminHeaders.Cookie.indexOf("=")+1), url: origin },
            ]);
            await context.addInitScript(() => {
              window.Paddle = { Environment: { set() {} }, Initialize({ eventCallback }) { window.qaPaymentEvent = eventCallback; },
                Checkout: { open(options) { window.qaCheckoutOptions = options; } } };
            });
            const page = await context.newPage();
            await page.goto(origin + "/zh/");
            await page.getByText("剩余 1 次压缩", { exact: true }).waitFor();
            await page.getByRole("link", { name: "购买次数", exact: true }).click();
            await page.getByRole("button", { name: "我的账户" }).waitFor();
            await page.getByLabel("3 次", { exact: true }).check();
            await page.getByRole("button", { name: "购买 3 次", exact: true }).click();
            await page.waitForFunction(() => Boolean(window.qaCheckoutOptions));
            const checkout = await page.evaluate(() => window.qaCheckoutOptions);
            assert.equal(checkout.items[0].quantity, 3);
            const bought = { ...transaction, id: `txn_${token}_browser`, customData: checkout.customData,
              items: [{ ...transaction.items[0], quantity: 3 }], details: { totals: { total: "2970", currencyCode: "CNY" } } };
            providerFixture.transactions[bought.id] = bought;
            await fsp.writeFile(qaProviderFile, JSON.stringify(providerFixture));
            async function notify(type, data) {
              const body = JSON.stringify({ event_id: "evt_" + crypto.randomUUID().replaceAll("-", ""), event_type: type, data });
              const ts = Math.floor(Date.now()/1000);
              const sig = crypto.createHmac("sha256", quotaEnv.PADDLE_WEBHOOK_SECRET).update(`${ts}:${body}`).digest("hex");
              assert.equal((await fetch(origin + "/api/paddle/webhook", { method: "POST", body,
                headers: { "Content-Type": "application/json", "Paddle-Signature": `ts=${ts};h1=${sig}` } })).status, 200);
            }
            await page.evaluate(() => window.qaPaymentEvent({ name: "checkout.completed" }));
            await notify("transaction.completed", { id: bought.id, status: "completed", items: [], payments: [] });
            await page.getByText("支付已确认，次数已到账。", { exact: true }).waitFor({ timeout: 25_000 });
            await page.goto(origin + "/zh/");
            await page.getByText("剩余 4 次压缩", { exact: true }).waitFor();
            await page.goto(origin + "/admin-payments");
            await page.getByLabel("邮箱、订单号或交易编号").fill(bought.id);
            await page.getByRole("button", { name: "搜索" }).click();
            await page.getByRole("button", { name: "申请退款", exact: true }).click();
            await page.getByLabel("退款原因").selectOption("other");
            await page.getByRole("checkbox").check();
            await page.getByRole("button", { name: "确认申请退款" }).click();
            await page.getByText("退款申请已提交，最终状态以支付平台确认为准。").waitFor();
            await page.getByRole("button", { name: "关闭", exact: true }).click();
            const adjustment = { id: `adj_${bought.id}`, transactionId: bought.id, type: "full", action: "refund", status: "approved" };
            providerFixture.adjustments[bought.id] = [adjustment];
            await fsp.writeFile(qaProviderFile, JSON.stringify(providerFixture));
            await notify("adjustment.updated", { id: adjustment.id, transaction_id: bought.id,
              action: "refund", type: "full", status: "approved", items: [], totals: { total: "2970", currency_code: "CNY" } });
            async function refundStatus() {
              return (await pool.query("SELECT status FROM payment_orders WHERE transaction_id=$1", [bought.id])).rows[0]?.status;
            }
            for (let attempt = 0; attempt < 100 && await refundStatus() !== "refunded"; attempt++) {
              await new Promise(resolve => setTimeout(resolve, 250));
            }
            assert.equal(await refundStatus(), "refunded");
            assert.equal((await balance(signedHeaders)).data.paid, 1);
            await page.getByRole("button", { name: "搜索" }).click();
            await page.getByText("已退款", { exact: true }).waitFor();
            await page.goto(origin + "/zh/");
            await page.getByText("剩余 1 次压缩", { exact: true }).waitFor();
            await page.locator("#pdf").setInputFiles({ name: "highly-compressible.pdf", mimeType: "application/pdf", buffer: pdf });
            await page.locator("#targetMB").fill(target.toFixed(7));
            await page.locator("#submit-button").click();
            await page.locator("#download-button").waitFor({ state: "visible" });
            await page.getByText("剩余 0 次压缩", { exact: true }).waitFor();
            const downloaded = page.waitForEvent("download");
            await page.locator("#download-button").click();
            assert.equal(await (await downloaded).failure(), null);
            console.log("PASS: real browser + local server + PostgreSQL purchase, signed notifications, admin refund, PDF download, and refreshed balance (mock provider)");
          } finally { await browser.close(); }
        }
      } finally { await pool.end(); }
    }
    console.log("compression regression test passed");
  } finally {
    child.kill("SIGTERM");
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
