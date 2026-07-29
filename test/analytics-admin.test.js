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
  normalizeLandingLanguage,
  sourceFor,
  sourceCategoryFor,
  appendAnalyticsEvent,
  readAnalyticsEvents,
  summarizeAnalytics,
} = require("../lib/analytics");
const { chooseAnalyticsFile } = require("../lib/analytics-path");

let passed = 0, failed = 0;
const SRV_DIR = path.join(__dirname, "..");
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

function parseCsv(text) {
  return text.replace(/^\uFEFF/, "").trim().split(/\r?\n/).map(line => {
    const cells = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];
      if (quoted && ch === '"' && next === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        quoted = !quoted;
      } else if (!quoted && ch === ",") {
        cells.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current);
    return cells;
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
  await test("source attribution only labels exact libindesign referrals as owned", async () => {
    assert.strictEqual(sourceFor({ referrer: "https://libindesign.cn/work/tinypdf", utm: {} }), "libindesign.cn");
    assert.strictEqual(sourceFor({ referrer: "https://www.libindesign.cn/work/tinypdf", utm: {} }), "libindesign.cn");
    assert.strictEqual(sourceFor({ referrer: "https://notes.libindesign.cn/tinypdf", utm: {} }), "libindesign.cn");
    assert.strictEqual(sourceCategoryFor({ referrer: "https://libindesign.cn/work/tinypdf", utm: {} }), "owned_referral");
    assert.strictEqual(sourceFor({ referrer: "", utm: {} }), "Direct");
    assert.strictEqual(sourceCategoryFor({ referrer: "", utm: {} }), "direct");
    assert.strictEqual(sourceCategoryFor({ referrer: "https://libindesign.cn.evil.example/", utm: {} }), "referral");
  });

  await test("normalizeLandingLanguage keeps supported landing languages", async () => {
    assert.strictEqual(normalizeLandingLanguage("zh-CN"), "zh-CN");
    assert.strictEqual(normalizeLandingLanguage("zh"), "zh-CN");
    assert.strictEqual(normalizeLandingLanguage("en-US"), "en");
    assert.strictEqual(normalizeLandingLanguage("fr"), "");
  });

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
      landingLanguage: "zh-CN",
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
    assert.strictEqual(events[0].landingLanguage, "zh-CN");
    assert.ok(events[0].ts, "event timestamp is added");
    assert.strictEqual(events[1].event, second.event);
    assert.ok(first.ts <= second.ts);
    await fsp.rm(dir, { recursive: true, force: true });
  });

  await test("summarizeAnalytics returns overview, funnel, sources, files, and recent events", async () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const events = [
      { ts: "2026-07-03T09:00:00.000Z", event: "page_view", sessionId: "s1", clientId: "c1", referrer: "https://medium.com/@zijinmengli/post", country: "US", utm: { source: "medium", medium: "article", campaign: "portfolio_pdf_designers", content: "medium_article_20260703" }, data: {} },
      { ts: "2026-07-03T09:01:00.000Z", event: "file_selected", sessionId: "s1", clientId: "c1", utm: { source: "medium", medium: "article", campaign: "portfolio_pdf_designers", content: "medium_article_20260703" }, data: { fileName: "portfolio.pdf", fileCategory: "design", fileBytes: 4 * 1024 * 1024 } },
      { ts: "2026-07-03T09:02:00.000Z", event: "compress_started", sessionId: "s1", clientId: "c1", utm: { source: "medium", medium: "article", campaign: "portfolio_pdf_designers", content: "medium_article_20260703" }, data: { fileName: "portfolio.pdf", fileCategory: "design", fileBytes: 4 * 1024 * 1024, targetMB: 1, targetBytes: 1024 * 1024 } },
      { ts: "2026-07-03T09:03:00.000Z", event: "compress_success", sessionId: "s1", clientId: "c1", utm: { source: "medium", medium: "article", campaign: "portfolio_pdf_designers", content: "medium_article_20260703" }, data: { fileName: "portfolio.pdf", fileCategory: "design", originalBytes: 4 * 1024 * 1024, targetMB: 1, targetBytes: 1024 * 1024, resultBytes: 900 * 1024, reachedTarget: true, rasterized: false } },
      { ts: "2026-07-03T09:04:00.000Z", event: "download_clicked", sessionId: "s1", clientId: "c1", utm: { source: "medium", medium: "article", campaign: "portfolio_pdf_designers", content: "medium_article_20260703" }, data: {} },
      { ts: "2026-07-03T09:05:00.000Z", event: "session_end", sessionId: "s1", clientId: "c1", utm: { source: "medium", medium: "article", campaign: "portfolio_pdf_designers", content: "medium_article_20260703" }, data: { dwellSeconds: 300 } },
      { ts: "2026-07-02T08:00:00.000Z", event: "page_view", sessionId: "s2", clientId: "c2", referrer: "", country: "JP", utm: { source: "webdesignernews", campaign: "portfolio_pdf_designers", content: "wdn_submission_20260703" }, data: {} },
      { ts: "2026-07-02T08:01:00.000Z", event: "compress_error", sessionId: "s2", clientId: "c2", utm: { source: "webdesignernews", campaign: "portfolio_pdf_designers", content: "wdn_submission_20260703" }, data: { reason: "Encrypted PDFs are not supported" } },
    ];
    const summary = summarizeAnalytics(events, now);
    assert.strictEqual(summary.overview.todayPageViews, 1);
    assert.strictEqual(summary.overview.pageViews7d, 2);
    assert.strictEqual(summary.overview.uniqueVisitors7d, 2);
    assert.strictEqual(summary.overview.todayCompressions, 1);
    assert.strictEqual(summary.overview.todayDownloads, 1);
    assert.strictEqual(summary.overview.successRate7d, 50);
    assert.strictEqual(summary.overview.comparisons.pageViews30d.delta, 2);
    assert.strictEqual(summary.overview.comparisons.pageViews30d.percent, 0);
    assert.strictEqual(summary.overview.comparisons.uniqueVisitors30d.delta, 2);
    assert.strictEqual(summary.overview.comparisons.compressSuccess30d.delta, 1);
    assert.strictEqual(summary.overview.comparisons.downloads30d.delta, 1);
    assert.strictEqual(summary.trends.daily.length, 30);
    assert.deepStrictEqual(summary.trends.daily.at(-1), { date: "2026-07-03", label: "07/03", pageViews: 1, visitors: 1 });
    assert.strictEqual(summary.funnel.page_view, 2);
    assert.strictEqual(summary.funnel.file_selected, 1);
    assert.strictEqual(summary.funnel.compress_success, 1);
    assert.strictEqual(summary.acquisition.sources[0].source, "medium");
    assert.strictEqual(summary.acquisition.promotions[0].source, "medium");
    assert.strictEqual(summary.acquisition.promotions[0].content, "medium_article_20260703");
    assert.strictEqual(summary.acquisition.promotions[0].visits, 1);
    assert.strictEqual(summary.acquisition.promotions[0].visitors, 1);
    assert.strictEqual(summary.acquisition.promotions[0].compressions, 1);
    assert.strictEqual(summary.acquisition.promotions[0].downloads, 1);
    assert.strictEqual(summary.geo.regions[0].region, "US");
    assert.strictEqual(summary.geo.regions[0].count, 1);
    assert.strictEqual(summary.geo.regions[1].region, "JP");
    assert.strictEqual(summary.geo.regions[1].count, 1);
    assert.strictEqual(summary.files.categories[0].category, "design");
    assert.strictEqual(summary.files.recentFileNames[0].fileName, "portfolio.pdf");
    assert.strictEqual(summary.files.recentFileNames[0].fileBytes, 4 * 1024 * 1024);
    assert.strictEqual(summary.files.recentFileNames[0].targetMB, 1);
    assert.strictEqual(summary.files.recentFileNames[0].targetBytes, 1024 * 1024);
    assert.strictEqual(summary.files.recentFileNames[0].resultBytes, 900 * 1024);
    assert.strictEqual(summary.files.recentFileNames[0].status, "success");
    assert.strictEqual(summary.behavior.averageDwellSeconds, 300);
    assert.strictEqual(summary.compression.averageSavingsRate, 78);
    assert.strictEqual(summary.compression.errorReasons[0].reason, "Encrypted PDFs are not supported");
    assert.strictEqual(summary.recentEvents.length, 8);
  });

  await test("summarizeAnalytics uses server compression events when client tracking is missing", async () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const events = [
      { ts: "2026-07-03T09:03:00.000Z", event: "compress_success", sessionId: "s1", clientId: "c1", data: { fileName: "client-portfolio.pdf", fileCategory: "design", originalBytes: 4 * 1024 * 1024, targetMB: 1, targetBytes: 1024 * 1024, resultBytes: 900 * 1024, reachedTarget: true } },
      { ts: "2026-07-03T09:04:00.000Z", event: "download_clicked", sessionId: "s1", clientId: "c1", data: { fileName: "client-portfolio.pdf", fileCategory: "design" } },
    ];
    const summary = summarizeAnalytics(events, now);
    assert.strictEqual(summary.funnel.file_selected, 1);
    assert.strictEqual(summary.funnel.compress_started, 1);
    assert.strictEqual(summary.files.categories[0].category, "design");
    assert.strictEqual(summary.files.recentFileNames[0].fileName, "client-portfolio.pdf");
    assert.strictEqual(summary.files.recentFileNames[0].fileBytes, 4 * 1024 * 1024);
    assert.strictEqual(summary.files.recentFileNames[0].targetMB, 1);
    assert.strictEqual(summary.files.recentFileNames[0].targetBytes, 1024 * 1024);
    assert.strictEqual(summary.files.recentFileNames[0].resultBytes, 900 * 1024);
  });

  await test("unique visitors only count users with page views", async () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const events = [
      { ts: "2026-07-03T09:00:00.000Z", event: "page_view", sessionId: "s1", clientId: "c1", data: {} },
      { ts: "2026-07-03T09:01:00.000Z", event: "file_selected", sessionId: "s1", clientId: "c1", data: { fileName: "portfolio.pdf" } },
      { ts: "2026-07-03T10:00:00.000Z", event: "compress_success", sessionId: "s2", clientId: "c2", data: { fileName: "missing-page-view.pdf" } },
    ];
    const summary = summarizeAnalytics(events, now);
    assert.strictEqual(summary.overview.pageViews7d, 1);
    assert.strictEqual(summary.overview.uniqueVisitors7d, 1);
  });

  await test("average compression time uses earliest start for each successful upload", async () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const shared = { sessionId: "s1", clientId: "c1", data: { fileName: "portfolio.pdf" } };
    const events = [
      { ts: "2026-07-03T09:00:00.000Z", event: "compress_started", ...shared },
      { ts: "2026-07-03T09:00:30.000Z", event: "compress_started", ...shared },
      { ts: "2026-07-03T09:02:00.000Z", event: "compress_success", ...shared },
      { ts: "2026-07-03T10:00:00.000Z", event: "compress_success", sessionId: "s2", clientId: "c2", data: { fileName: "no-start.pdf" } },
    ];
    const summary = summarizeAnalytics(events, now);
    assert.strictEqual(summary.behavior.averageCompressionSeconds, 120);
  });

  await test("summarizeAnalytics deduplicates client and server file events for one upload", async () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const shared = { sessionId: "same-session", clientId: "same-client", data: { fileName: "sales-deck.pdf", fileCategory: "presentation", fileBytes: 2 * 1024 * 1024 } };
    const events = [
      { ts: "2026-07-03T09:00:00.000Z", event: "file_selected", ...shared },
      { ts: "2026-07-03T09:00:01.000Z", event: "file_selected", ...shared },
      { ts: "2026-07-03T09:00:02.000Z", event: "compress_started", ...shared, data: { ...shared.data, targetMB: 1 } },
      { ts: "2026-07-03T09:00:03.000Z", event: "compress_started", ...shared, data: { ...shared.data, targetMB: 1 } },
      { ts: "2026-07-03T09:00:04.000Z", event: "compress_success", ...shared, data: { ...shared.data, targetMB: 1, targetBytes: 1024 * 1024, resultBytes: 900 * 1024, reachedTarget: true } },
    ];
    const summary = summarizeAnalytics(events, now);
    assert.strictEqual(summary.funnel.file_selected, 1);
    assert.strictEqual(summary.funnel.compress_started, 1);
    assert.strictEqual(summary.files.categories[0].count, 1);
    assert.strictEqual(summary.files.recentFileNames.length, 1);
  });

  await test("funnel preserves repeated successful attempts for the same file", async () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const shared = {
      sessionId: "same-session",
      clientId: "same-client",
      data: { fileName: "sales-deck.pdf", fileCategory: "presentation", fileBytes: 2 * 1024 * 1024 },
    };
    const events = [
      { ts: "2026-07-03T09:00:00.000Z", event: "file_selected", ...shared },
      { ts: "2026-07-03T09:00:01.000Z", event: "compress_started", ...shared },
      { ts: "2026-07-03T09:00:10.000Z", event: "compress_success", ...shared },
      { ts: "2026-07-03T09:00:20.000Z", event: "download_clicked", ...shared },
      { ts: "2026-07-03T10:00:00.000Z", event: "file_selected", ...shared },
      { ts: "2026-07-03T10:00:01.000Z", event: "compress_started", ...shared },
      { ts: "2026-07-03T10:00:10.000Z", event: "compress_success", ...shared },
      { ts: "2026-07-03T10:00:20.000Z", event: "download_clicked", ...shared },
    ];

    const summary = summarizeAnalytics(events, now);

    assert.deepStrictEqual(summary.funnel, {
      page_view: 0,
      file_selected: 2,
      compress_started: 2,
      compress_success: 2,
      download_clicked: 2,
    });
  });

  await test("chooseAnalyticsFile prefers explicit env and Railway volume paths", async () => {
    assert.strictEqual(
      chooseAnalyticsFile({ ANALYTICS_FILE: "/custom/events.jsonl", RAILWAY_VOLUME_MOUNT_PATH: "/volume" }, "/app"),
      "/custom/events.jsonl"
    );
    assert.strictEqual(
      chooseAnalyticsFile({ RAILWAY_VOLUME_MOUNT_PATH: "/volume" }, "/app"),
      "/volume/analytics-events.jsonl"
    );
    assert.strictEqual(
      chooseAnalyticsFile({}, "/app"),
      "/app/data/analytics-events.jsonl"
    );
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

  await test("admin session can read summary and export CSV for tracked events", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "tinypdf-admin-password-"));
    const srv = await startServer(3822, {
      ADMIN_PASSWORD: "secret-pass",
      ADMIN_SESSION_SECRET: "test-session-secret",
      ANALYTICS_FILE: path.join(dir, "events.jsonl"),
    });
    try {
      const denied = await request(3822, "GET", "/api/admin/summary");
      assert.strictEqual(denied.status, 401);

      const landing = await request(
        3822,
        "GET",
        "/?utm_source=medium&utm_medium=article&utm_campaign=portfolio_pdf_designers&utm_content=medium_article_20260703",
        null,
        { Referer: "https://www.uneed.best/tool/tinypdf" }
      );
      const webCookie = landing.headers["set-cookie"]
        .find(value => value.startsWith("tinypdf_web_session="))
        .split(";")[0];
      const track = await request(3822, "POST", "/api/track", {
        event: "file_selected",
        sessionId: "s-track",
        clientId: "c-track",
        data: { fileName: "sales-deck.pdf", fileBytes: 2 * 1024 * 1024 },
      }, { "CF-IPCountry": "US", Cookie: webCookie });
      assert.strictEqual(track.status, 200);

      const login = await request(3822, "POST", "/api/admin/login", { password: "secret-pass" });
      assert.strictEqual(login.status, 200);
      const cookie = login.headers["set-cookie"].find(value => value.startsWith("tinypdf_admin=")).split(";")[0];
      const summary = await request(3822, "GET", "/api/admin/summary", null, { Cookie: cookie });
      assert.strictEqual(summary.status, 200);
      assert.strictEqual(summary.headers["cache-control"], "no-store");
      const body = JSON.parse(summary.body);
      assert.strictEqual(body.files.categories[0].category, "presentation");
      assert.strictEqual(body.files.recentFileNames[0].fileName, "sales-deck.pdf");
      assert.strictEqual(body.files.recentFileNames[0].fileBytes, 2 * 1024 * 1024);
      assert.strictEqual(body.geo.regions[0].region, "US");
      assert.strictEqual(body.geo.regions[0].count, 1);
      assert.strictEqual(body.acquisition.promotions[0].source, "medium");
      assert.strictEqual(body.acquisition.promotions[0].content, "medium_article_20260703");

      const csv = await request(3822, "GET", "/api/admin/export?range=1m", null, { Cookie: cookie });
      assert.strictEqual(csv.status, 200);
      assert.ok(csv.headers["content-type"].includes("text/csv"));
      assert.ok(csv.headers["content-disposition"].includes("tinypdf-analytics-1m.csv"));
      const parsed = parseCsv(csv.body);
      assert.deepStrictEqual(parsed[0].slice(0, 9), ["时间", "事件", "平台", "媒介", "活动", "文章/内容", "地区", "设备", "浏览器"]);
      assert.ok(parsed.some(row => row.includes("medium_article_20260703") && row.includes("sales-deck.pdf")));

      const adminPage = await request(3822, "GET", "/admin");
      assert.strictEqual(adminPage.status, 200);
      assert.ok(adminPage.body.includes("TinyPDF 数据后台"));
      assert.ok(adminPage.body.includes("推广来源"));
      assert.ok(adminPage.body.includes("下载历史数据"));
      assert.ok(adminPage.body.includes("用户输入目标"));
      assert.ok(adminPage.body.includes("压缩后大小"));
      assert.ok(adminPage.body.includes("refresh-status"));
      assert.ok(adminPage.body.includes("上次更新"));
      assert.ok(adminPage.body.includes("近 1 个月"));
      assert.ok(adminPage.body.includes("/admin.js"));

      const adminJs = await fsp.readFile(path.join(SRV_DIR, "public", "admin.js"), "utf8");
      assert.ok(adminJs.includes("refresh-status"));
      assert.ok(adminJs.includes("刷新中"));
      assert.ok(adminJs.includes('cache: "no-store"'));
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
