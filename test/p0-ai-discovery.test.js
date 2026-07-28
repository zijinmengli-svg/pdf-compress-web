"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const SRV_DIR = path.join(__dirname, "..");
const PORT = 3921;
let passed = 0;
let failed = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function get(requestPath) {
  return new Promise((resolve, reject) => {
    http.get({
      host: "127.0.0.1",
      port: PORT,
      path: requestPath,
      headers: {
        "User-Agent": "Mozilla/5.0 Chrome/120",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
      },
    }, res => {
      let body = "";
      res.on("data", chunk => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    }).on("error", reject);
  });
}

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS - ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL - ${name} :: ${error.message}`);
  }
}

async function startServer() {
  const server = spawn("node", ["server-simple.js"], {
    cwd: SRV_DIR,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      GA_API_SECRET: "",
    },
  });

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await get("/api/config")).status === 200) return server;
    } catch {}
    await sleep(100);
  }

  server.kill("SIGKILL");
  throw new Error("server did not start");
}

(async () => {
  const server = await startServer();
  try {
    await check("English directory route is crawlable", async () => {
      const response = await get("/en/");
      assert.strictEqual(response.status, 200);
    });

    await check("robots explicitly allows AI search and user agents", async () => {
      const response = await get("/robots.txt");
      assert.strictEqual(response.status, 200);
      assert.match(response.body, /User-agent: OAI-SearchBot\s+Allow: \//);
      assert.match(response.body, /User-agent: Claude-SearchBot\s+Allow: \//);
      assert.match(response.body, /User-agent: Claude-User\s+Allow: \//);
      assert.match(response.body, /User-agent: PerplexityBot\s+Allow: \//);
      assert.match(response.body, /User-agent: Bytespider\s+Allow: \//);
    });

    await check("robots blocks training bots and protects admin", async () => {
      const response = await get("/robots.txt");
      assert.match(response.body, /User-agent: GPTBot\s+Disallow: \//);
      assert.match(response.body, /User-agent: ClaudeBot\s+Disallow: \//);
      assert.match(response.body, /User-agent: \*\s+Allow: \/\s+Disallow: \/admin/);
    });

    await check("sitemap includes the English homepage", async () => {
      const response = await get("/sitemap.xml");
      assert.strictEqual(response.status, 200);
      assert.match(response.body, /<loc>https:\/\/tinypdf\.cn\/en\/<\/loc>/);
    });

    await check("Chinese homepage has crawlable intent and language metadata", async () => {
      const response = await get("/");
      assert.strictEqual(response.status, 200);
      assert.match(response.body, /<html lang="zh-CN">/);
      assert.match(response.body, /将 PDF 压缩到指定大小/);
      assert.match(response.body, /<h1 class="product-title">\s*<span class="product-name">TinyPDF<\/span>\s*<span class="product-descriptor">指定大小 PDF 压缩工具<\/span>\s*<\/h1>/);
      assert.match(response.body, /约一小时后自动删除/);
      assert.match(response.body, /<link rel="canonical" href="https:\/\/tinypdf\.cn\/"\s*\/>/);
      assert.match(response.body, /hreflang="zh-CN" href="https:\/\/tinypdf\.cn\/"/);
      assert.match(response.body, /hreflang="en" href="https:\/\/tinypdf\.cn\/en\/"/);
      assert.match(response.body, /hreflang="x-default" href="https:\/\/tinypdf\.cn\/"/);
      assert.ok(
        response.body.indexOf('src="/i18n.js') < response.body.indexOf('src="/app-simple.js'),
        "i18n.js must load before app-simple.js"
      );
    });

    await check("English homepage keeps matching facts and self canonical", async () => {
      const response = await get("/en/");
      assert.strictEqual(response.status, 200);
      assert.match(response.body, /<html lang="en">/);
      assert.match(response.body, /Compress a PDF to a target file size/);
      assert.match(response.body, /automatically deleted after about one hour/);
      assert.match(response.body, /<link rel="canonical" href="https:\/\/tinypdf\.cn\/en\/"\s*\/>/);
      assert.match(response.body, /hreflang="zh-CN" href="https:\/\/tinypdf\.cn\/"/);
      assert.match(response.body, /hreflang="en" href="https:\/\/tinypdf\.cn\/en\/"/);
      assert.ok(
        response.body.indexOf('src="/i18n.js') < response.body.indexOf('src="/app-simple.js'),
        "i18n.js must load before app-simple.js"
      );
    });

    await check("Chinese and English FAQ routes are both crawlable", async () => {
      const chinese = await get("/faq");
      const english = await get("/en/faq");
      assert.strictEqual(chinese.status, 200);
      assert.strictEqual(english.status, 200);
      assert.match(chinese.body, /<html lang="zh-CN">/);
      assert.match(chinese.body, /TinyPDF 是什么/);
      assert.match(english.body, /<html lang="en">/);
      assert.match(english.body, /What does TinyPDF do/);
    });

    await check("responsive CSS wraps copy without mobile-only product features", async () => {
      const css = fs.readFileSync(path.join(SRV_DIR, "public", "styles.css"), "utf8");
      const leadRule = css.match(/\.lead\s*\{([^}]*)\}/);
      assert.ok(leadRule, "lead rule must exist");
      assert.doesNotMatch(leadRule[1], /white-space:\s*nowrap/);
      assert.doesNotMatch(leadRule[1], /text-overflow:\s*ellipsis/);
      assert.match(leadRule[1], /overflow-wrap:\s*anywhere/);
      assert.match(css, /\.product-title\s*\{[^}]*display:\s*flex[^}]*\}/);
      assert.match(css, /\.product-descriptor\s*\{[^}]*font-size:\s*clamp\(/);

      const mobileStart = css.indexOf("@media (max-width: 640px)");
      const mobileEnd = css.indexOf("/* Usage counter", mobileStart);
      assert.ok(mobileStart >= 0 && mobileEnd > mobileStart, "640px responsive block must exist");
      const mobileBlock = css.slice(mobileStart, mobileEnd);
      assert.match(mobileBlock, /\.topbar[\s\S]*\.footer-inner[\s\S]*align-items:\s*flex-start/);

      const home = await get("/");
      assert.doesNotMatch(home.body, /class="target-presets"/);
      assert.doesNotMatch(home.body, />500KB</);
      assert.doesNotMatch(home.body, /Desktop web only/);
    });
  } finally {
    server.kill("SIGKILL");
  }

  console.log(`\nSUMMARY: ${passed}/${passed + failed} passed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(error => {
  console.log(`HARNESS ERROR: ${error.stack || error}`);
  process.exit(1);
});
