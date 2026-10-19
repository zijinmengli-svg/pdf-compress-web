"use strict";

const assert = require("assert");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const SRV_DIR = path.join(__dirname, "..");
const PORT = 3931;
const PAGES = [
  { path: "/compress-pdf-to-1mb", target: "1" },
  { path: "/compress-pdf-to-2mb", target: "2" },
  { path: "/compress-pdf-to-5mb", target: "5" },
  { path: "/compress-pdf-to-10mb", target: "10" },
  { path: "/compress-pdf-to-20mb", target: "20" },
];
const INTENT_PAGES = [
  { path: "/compress-portfolio-pdf", target: "10" },
  { path: "/compress-pdf-for-job-application", target: "5" },
  { path: "/compress-figma-pdf", target: "10" },
  { path: "/compress-pdf-for-email", target: "20" },
  { path: "/compress-pdf-without-losing-quality", target: "20" },
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function get(requestPath) {
  return new Promise((resolve, reject) => {
    http.get({
      host: "127.0.0.1",
      port: PORT,
      path: requestPath,
      headers: {
        "User-Agent": "Mozilla/5.0 Chrome/126",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
      },
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    }).on("error", reject);
  });
}

async function startServer() {
  const server = spawn("node", ["server-simple.js"], {
    cwd: SRV_DIR,
    stdio: ["ignore", "ignore", "inherit"],
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

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function visibleWords(html) {
  return new Set(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()
    .match(/[a-z]{4,}/g) || []);
}

function jaccard(left, right) {
  const overlap = [...left].filter(word => right.has(word)).length;
  return overlap / new Set([...left, ...right]).size;
}

(async () => {
  const server = await startServer();

  try {
    for (const page of PAGES) {
      const response = await get(page.path);
      assert.strictEqual(response.status, 200, `${page.path} must return 200`);
      assert.strictEqual(
        countMatches(response.body, /<link\s+rel="canonical"\s+href="[^"]+"/g),
        1,
        `${page.path} must have exactly one canonical URL`
      );
      assert.match(
        response.body,
        new RegExp(`<link\\s+rel="canonical"\\s+href="https://tinypdf\\.cn${page.path}"`),
        `${page.path} must use its extensionless canonical URL`
      );
      assert.match(response.body, /<meta\s+name="robots"\s+content="index, follow"/);
      assert.match(response.body, /<form\s+id="compress-form"/);
      assert.match(response.body, /<input\s+id="pdf"[^>]+type="file"/);
      assert.match(
        response.body,
        new RegExp(`<input\\s+id="targetMB"[^>]+value="${page.target}"`),
        `${page.path} must preset ${page.target}MB`
      );
      assert.match(response.body, /src="\/web-request\.js\?v=1\.0\.0"/);
      assert.match(response.body, /src="\/app-simple\.js\?v=2\.0\.[12]"/);
      assert.match(response.body, /<body\s+class="sketch-ui"/);
      assert.match(response.body, /href="\/sketch-ui\.css\?v=2"/);
      assert.match(response.body, /class="brand"/);
      assert.match(response.body, /class="language-menu"/);
      assert.match(response.body, /id="upload-icon"/);
      assert.match(response.body, /class="status-icon"/);
      assert.match(response.body, /id="retry-button"/);
      assert.match(response.body, /src="\/sketch-ui\.js\?v=2\.1\.0"/);
    }

    const homepage = await get("/");
    const sitemap = await get("/sitemap.xml");
    const llms = await get("/llms.txt");

    for (const page of PAGES) {
      assert.match(homepage.body, new RegExp(`href="${page.path}"`));
      assert.match(sitemap.body, new RegExp(`<loc>https://tinypdf\\.cn${page.path}</loc>`));
      assert.match(llms.body, new RegExp(`https://tinypdf\\.cn${page.path}`));
    }

    const intentDocuments = [];
    for (const page of INTENT_PAGES) {
      const response = await get(page.path);
      assert.strictEqual(response.status, 200, `${page.path} must return 200`);
      assert.strictEqual(countMatches(response.body, /<title>[^<]+<\/title>/g), 1);
      assert.strictEqual(countMatches(response.body, /<h1\b[^>]*>/g), 1);
      assert.strictEqual(countMatches(response.body, /<meta\s+name="description"\s+content="[^"]+"/g), 1);
      assert.match(response.body, new RegExp(`<link\\s+rel="canonical"\\s+href="https://tinypdf\\.cn${page.path}"`));
      assert.match(response.body, /<meta\s+name="robots"\s+content="index, follow"/);
      assert.match(response.body, /<form\s+id="compress-form"/);
      assert.match(response.body, new RegExp(`<input\\s+id="targetMB"[^>]+value="${page.target}"`));
      assert.match(response.body, /class="[^"]*target-guidance[^"]*"/);
      assert.match(response.body, /class="[^"]*quality-caveat[^"]*"/);
      assert.match(response.body, /<nav\s+class="[^"]*related-tools[^"]*"/);
      assert.match(response.body, /<body\s+class="sketch-ui"/);
      assert.match(response.body, /href="\/sketch-ui\.css\?v=[23]"/);
      assert.match(response.body, /class="brand"/);
      assert.match(response.body, /class="language-menu"/);
      assert.match(response.body, /id="upload-icon"/);
      assert.match(response.body, /class="status-icon"/);
      assert.match(response.body, /id="retry-button"/);
      assert.match(response.body, /src="\/sketch-ui\.js\?v=2\.1\.0"/);
      assert.ok(countMatches(response.body, /<a\s+href="\/compress-[^"]+"/g) >= 2, `${page.path} needs related tool links`);
      assert.match(homepage.body, new RegExp(`href="${page.path}"`));
      assert.match(sitemap.body, new RegExp(`<loc>https://tinypdf\\.cn${page.path}</loc>`));

      intentDocuments.push({
        path: page.path,
        title: response.body.match(/<title>([^<]+)<\/title>/)[1],
        h1: response.body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)[1].replace(/<[^>]+>/g, " ").trim(),
        description: response.body.match(/<meta\s+name="description"\s+content="([^"]+)"/)[1],
        words: visibleWords(response.body),
      });
    }

    const portfolioZh = await get("/zh/compress-portfolio-pdf");
    assert.strictEqual(portfolioZh.status, 200);
    assert.match(portfolioZh.body, /<html lang="zh-CN">/);
    assert.match(portfolioZh.body, /<h2>压缩设计作品集 PDF<\/h2>/);
    assert.match(portfolioZh.body, /rel="canonical" href="https:\/\/tinypdf\.cn\/zh\/compress-portfolio-pdf"/);
    assert.match(sitemap.body, /<loc>https:\/\/tinypdf\.cn\/zh\/compress-portfolio-pdf<\/loc>/);

    assert.strictEqual(new Set(intentDocuments.map(page => page.title)).size, INTENT_PAGES.length, "intent titles must be unique");
    assert.strictEqual(new Set(intentDocuments.map(page => page.h1)).size, INTENT_PAGES.length, "intent H1s must be unique");
    assert.strictEqual(new Set(intentDocuments.map(page => page.description)).size, INTENT_PAGES.length, "intent descriptions must be unique");
    for (let left = 0; left < intentDocuments.length; left++) {
      for (let right = left + 1; right < intentDocuments.length; right++) {
        const similarity = jaccard(intentDocuments[left].words, intentDocuments[right].words);
        assert.ok(
          similarity < 0.72,
          `${intentDocuments[left].path} and ${intentDocuments[right].path} repeat too much text (${similarity.toFixed(2)})`
        );
      }
    }

    console.log("PASS - ten search landing pages are crawlable, usable, unique, and internally discoverable");
  } finally {
    server.kill("SIGKILL");
  }
})().catch(error => {
  console.error(`FAIL - ${error.stack || error}`);
  process.exit(1);
});
