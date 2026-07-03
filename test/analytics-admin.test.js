"use strict";
const assert = require("assert");
const fs = require("fs");
const fsp = fs.promises;
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const {
  classifyFileName,
  appendAnalyticsEvent,
  readAnalyticsEvents,
  summarizeAnalytics,
} = require("../lib/analytics");

let passed = 0, failed = 0;
const SRV_DIR = "/Users/libin/Desktop/我的工作流集合/PDF压缩工具-最终版";
async function test(name, fn) {
  try {
    await fn();
    console.log("PASS - " + name);
    passed++;
  } catch (e) {
    console.log("FAIL - " + name + " :: " + e.message);
    failed++;
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function request(port, method, requestPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? "" : typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: requestPath,
      method,
      headers: {
        "User-Agent": "Mozilla/5.0 Chrome/120",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, res => {
      let responseBody = "";
      res.on("data", chunk => responseBody += chunk);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: responseBody }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function startServer(port, env) {
  const srv = spawn("node", ["server-simple.js"], {
    cwd: SRV_DIR,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", GA_API_SECRET: "", ...env },
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await request(port, "GET", "/api/config")).status === 200) return srv;
    } catch {}
    await sleep(100);
  }
  throw new Error("server did not start on " + port);
}

(async () => {
  await test("classifyFileName uses filename-only keyword rules", async () => {
    assert.strictEqual(classifyFileName("Q3 investor presentation.pdf"), "presentation");
    assert.strictEqual(classifyFileName("ux-portfolio-final.pdf"), "design");
    assert.strictEqual(classifyFileName("Jane_Doe_CV.pdf"), "resume");
    assert.strictEqual(classifyFileName("visa-application-form.pdf"), "document");
    assert.strictEqual(classifyFileName("research-thesis-draft.pdf"), "academic");
    assert.strictEqual(classifyFileName("client_scanned_copy.pdf"), "scan");
    assert.strictEqual(classifyFileName("random-upload.pdf"), "other");
  });

  await test("appendAnalyticsEvent writes JSONL and readAnalyticsEvents skips broken lines", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "tinypdf-analytics-test-"));
    const file = path.join(dir, "events.jsonl");
    const first = await appendAnalyticsEvent(file, {
      event: "file_selected",
      sessionId: "s1",
      data: { fileName: "portfolio.pdf" },
    });
    await fsp.appendFile(file, "{not json}\n");
    const second = await appendAnalyticsEvent(file, {
      event: "download_clicked",
      sessionId: "s1",
      data: {},
    });
    const events = await readAnalyticsEvents(file);
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].event, "file_selected");
    assert.strictEqual(events[0].data.fileCategory, "design");
    assert.ok(events[0].ts, "event timestamp is added");
    assert.strictEqual(events[1].event, second.event);
    assert.ok(first.ts <= second.ts);
    await fsp.rm(dir, { recursive: true, force: true });
  });

  await test("summarizeAnalytics returns overview, funnel, sources, files, and recent events", async () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const events = [
      { ts: "2026-07-03T09:00:00.000Z", event: "page_view", sessionId: "s1", clientId: "c1", referrer: "https://dev.to/post", data: {} },
      { ts: "2026-07-03T09:01:00.000Z", event: "file_selected", sessionId: "s1", clientId: "c1", data: { fileName: "portfolio.pdf", fileCategory: "design", fileBytes: 4 * 1024 * 1024 } },
      { ts: "2026-07-03T09:02:00.000Z", event: "compress_started", sessionId: "s1", clientId: "c1", data: { targetMB: 1 } },
      { ts: "2026-07-03T09:03:00.000Z", event: "compress_success", sessionId: "s1", clientId: "c1", data: { originalBytes: 4 * 1024 * 1024, targetBytes: 1024 * 1024, resultBytes: 900 * 1024, reachedTarget: true, rasterized: false } },
      { ts: "2026-07-03T09:04:00.000Z", event: "download_clicked", sessionId: "s1", clientId: "c1", data: {} },
      { ts: "2026-07-03T09:05:00.000Z", event: "session_end", sessionId: "s1", clientId: "c1", data: { dwellSeconds: 300 } },
      { ts: "2026-07-02T08:00:00.000Z", event: "page_view", sessionId: "s2", clientId: "c2", referrer: "", data: {} },
      { ts: "2026-07-02T08:01:00.000Z", event: "compress_error", sessionId: "s2", clientId: "c2", data: { reason: "Encrypted PDFs are not supported" } },
    ];
    const summary = summarizeAnalytics(events, now);
    assert.strictEqual(summary.overview.todayPageViews, 1);
    assert.strictEqual(summary.overview.pageViews7d, 2);
    assert.strictEqual(summary.overview.uniqueVisitors7d, 2);
    assert.strictEqual(summary.overview.todayCompressions, 1);
    assert.strictEqual(summary.overview.todayDownloads, 1);
    assert.strictEqual(summary.overview.successRate7d, 50);
    assert.strictEqual(summary.funnel.page_view, 2);
    assert.strictEqual(summary.funnel.file_selected, 1);
    assert.strictEqual(summary.funnel.compress_success, 1);
    assert.strictEqual(summary.acquisition.sources[0].source, "dev.to");
    assert.strictEqual(summary.files.categories[0].category, "design");
    assert.strictEqual(summary.files.recentFileNames[0].fileName, "portfolio.pdf");
    assert.strictEqual(summary.behavior.averageDwellSeconds, 300);
    assert.strictEqual(summary.compression.errorReasons[0].reason, "Encrypted PDFs are not supported");
    assert.strictEqual(summary.recentEvents.length, 8);
  });

  await test("admin login is unavailable without ADMIN_PASSWORD", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "tinypdf-admin-no-password-"));
    const srv = await startServer(3821, {
      ADMIN_PASSWORD: "",
      ANALYTICS_FILE: path.join(dir, "events.jsonl"),
    });
    try {
      const res = await request(3821, "POST", "/api/admin/login", { password: "anything" });
      assert.strictEqual(res.status, 503);
      assert.ok(res.body.includes("ADMIN_DISABLED"));
    } finally {
      srv.kill("SIGKILL");
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  await test("admin session can read summary for tracked events", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "tinypdf-admin-password-"));
    const srv = await startServer(3822, {
      ADMIN_PASSWORD: "secret-pass",
      ADMIN_SESSION_SECRET: "test-session-secret",
      ANALYTICS_FILE: path.join(dir, "events.jsonl"),
    });
    try {
      const denied = await request(3822, "GET", "/api/admin/summary");
      assert.strictEqual(denied.status, 401);

      const track = await request(3822, "POST", "/api/track", {
        event: "file_selected",
        sessionId: "s-track",
        clientId: "c-track",
        referrer: "https://www.uneed.best/tool/tinypdf",
        data: { fileName: "sales-deck.pdf", fileBytes: 2 * 1024 * 1024 },
      });
      assert.strictEqual(track.status, 200);

      const login = await request(3822, "POST", "/api/admin/login", { password: "secret-pass" });
      assert.strictEqual(login.status, 200);
      const cookie = login.headers["set-cookie"].find(value => value.startsWith("tinypdf_admin=")).split(";")[0];
      const summary = await request(3822, "GET", "/api/admin/summary", null, { Cookie: cookie });
      assert.strictEqual(summary.status, 200);
      const body = JSON.parse(summary.body);
      assert.strictEqual(body.files.categories[0].category, "presentation");
      assert.strictEqual(body.files.recentFileNames[0].fileName, "sales-deck.pdf");

      const adminPage = await request(3822, "GET", "/admin");
      assert.strictEqual(adminPage.status, 200);
      assert.ok(adminPage.body.includes("TinyPDF Analytics"));
      assert.ok(adminPage.body.includes("/admin.js"));
    } finally {
      srv.kill("SIGKILL");
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  console.log(`\nSUMMARY: ${passed}/${passed + failed} passed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => {
  console.log("HARNESS ERROR: " + (e.stack || e));
  process.exit(1);
});
