"use strict";
const assert = require("assert");
const http = require("http");
const { spawn } = require("child_process");

const SRV_DIR = "/Users/libin/Desktop/我的工作流集合/PDF压缩工具-最终版";
let passed = 0, failed = 0;
function check(name, cond, detail) { (cond ? passed++ : failed++); console.log(`${cond ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function get(port, path) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path, headers: { "User-Agent": "Mozilla/5.0 Chrome/120", "Sec-Fetch-Mode": "navigate" } }, (r) => {
      let d = ""; r.on("data", c => d += c); r.on("end", () => res({ status: r.statusCode, headers: r.headers, body: d }));
    }).on("error", rej);
  });
}
async function startServer(port, env) {
  const srv = spawn("node", ["server-simple.js"], { cwd: SRV_DIR, stdio: ["ignore", "ignore", "ignore"], env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", ...env } });
  for (let i = 0; i < 60; i++) { try { if ((await get(port, "/api/config")).status === 200) return srv; } catch {} await sleep(100); }
  throw new Error("server did not start on " + port);
}

(async () => {
  // ── 广告关闭（默认）──
  const s1 = await startServer(3711, { AD_ENABLED: "", AD_CLIENT: "", AD_SLOT: "" });
  const cfg1 = JSON.parse((await get(3711, "/api/config")).body);
  check("disabled: adsEnabled=false", cfg1.adsEnabled === false, JSON.stringify(cfg1));
  check("disabled: adClient empty", cfg1.adClient === "", String(cfg1.adClient));
  check("disabled: adSlot empty", cfg1.adSlot === "", String(cfg1.adSlot));
  const home1 = await get(3711, "/");
  const csp1 = home1.headers["content-security-policy"] || "";
  check("disabled: CSP strict (no googlesyndication)", !csp1.includes("googlesyndication"), csp1.slice(0, 80));
  s1.kill("SIGKILL");

  // ── 广告启用 + 假 ID ──
  const s2 = await startServer(3712, { AD_ENABLED: "true", AD_CLIENT: "ca-pub-test", AD_SLOT: "123456" });
  const cfg2 = JSON.parse((await get(3712, "/api/config")).body);
  check("enabled: adsEnabled=true", cfg2.adsEnabled === true);
  check("enabled: adClient passed", cfg2.adClient === "ca-pub-test", cfg2.adClient);
  check("enabled: adSlot passed", cfg2.adSlot === "123456", cfg2.adSlot);
  const home2 = await get(3712, "/");
  const csp2 = home2.headers["content-security-policy"] || "";
  check("enabled: CSP allows googlesyndication script", csp2.includes("pagead2.googlesyndication.com"), csp2.slice(0, 120));
  s2.kill("SIGKILL");

  console.log(`\nSUMMARY: ${passed}/${passed + failed} passed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.log("HARNESS ERROR: " + (e.stack || e)); process.exit(1); });
