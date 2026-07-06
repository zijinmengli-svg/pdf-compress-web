"use strict";
// 验证服务端 page_view 只对「真实顶层浏览器导航」上报，过滤爬虫/扫描/健康检查/预取，
// 修正活跃用户虚高。用本地 GA mock 端点捕获事件。
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const SRV_DIR = path.join(__dirname, "..");
const SRV_PORT = 3811, MOCK_PORT = 3812;
const UA_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let passed = 0, failed = 0;
function check(name, cond, detail) { (cond ? passed++ : failed++); console.log(`${cond ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const gaEvents = [];
const mock = http.createServer((req, res) => { let b = ""; req.on("data", c => b += c); req.on("end", () => { try { gaEvents.push(JSON.parse(b)); } catch {} res.writeHead(204); res.end(); }); });

function get(headers) { return new Promise((res, rej) => { http.get({ host: "127.0.0.1", port: SRV_PORT, path: "/", headers }, r => { r.resume(); r.on("end", () => res(r.statusCode)); }).on("error", rej); }); }
const pageViews = () => gaEvents.filter(e => e.events && e.events[0] && e.events[0].name === "page_view").length;

let srv;
(async () => {
  await new Promise(r => mock.listen(MOCK_PORT, r));
  srv = spawn("node", ["server-simple.js"], { cwd: SRV_DIR, stdio: ["ignore", "ignore", "ignore"], env: { ...process.env, PORT: String(SRV_PORT), HOST: "127.0.0.1", GA_MEASUREMENT_ID: "G-TEST", GA_API_SECRET: "dummy", GA_MP_ENDPOINT: `http://127.0.0.1:${MOCK_PORT}` } });
  for (let i = 0; i < 60; i++) { try { await get({ "User-Agent": UA_CHROME }); break; } catch {} await sleep(100); }

  // A: 真实浏览器顶层导航 → 应上报
  gaEvents.length = 0; await get({ "User-Agent": UA_CHROME, "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" }); await sleep(400);
  check("A: real navigate → page_view fires", pageViews() >= 1, "count=" + pageViews());

  // B: 无 Sec-Fetch-Mode（爬虫/扫描典型）→ 不应上报
  gaEvents.length = 0; await get({ "User-Agent": UA_CHROME }); await sleep(400);
  check("B: no Sec-Fetch-Mode → no page_view", pageViews() === 0, "count=" + pageViews());

  // C: navigate 但爬虫 UA → 不应上报
  gaEvents.length = 0; await get({ "User-Agent": "Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)", "Sec-Fetch-Mode": "navigate" }); await sleep(400);
  check("C: bot UA → no page_view", pageViews() === 0, "count=" + pageViews());

  // D: 预取/预渲染 → 不应上报
  gaEvents.length = 0; await get({ "User-Agent": UA_CHROME, "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", "Sec-Purpose": "prefetch" }); await sleep(400);
  check("D: prefetch → no page_view", pageViews() === 0, "count=" + pageViews());

  console.log(`\nSUMMARY: ${passed}/${passed + failed} passed`);
})().catch(e => { console.log("HARNESS ERROR: " + (e.stack || e)); failed++; }).finally(async () => {
  await sleep(100); try { srv && srv.kill("SIGKILL"); } catch {} try { mock.close(); } catch {}
  process.exit(failed === 0 ? 0 : 1);
});
