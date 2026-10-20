"use strict";

const assert = require("assert");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const PORT = 3942;
const ROOT = path.join(__dirname, "..");
const retired = [
  "/compress-pdf-to-20mb",
  "/compress-pdf-to-10mb",
  "/compress-pdf-to-5mb",
  "/compress-pdf-to-2mb",
  "/compress-pdf-to-1mb",
  "/compress-portfolio-pdf",
  "/zh/compress-portfolio-pdf",
  "/compress-pdf-for-job-application",
  "/compress-figma-pdf",
  "/compress-pdf-for-email",
  "/compress-pdf-without-losing-quality",
];

function get(route) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: PORT, path: route }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        location: response.headers.location,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    }).on("error", reject);
  });
}

async function startServer() {
  const server = spawn(process.execPath, ["server-simple.js"], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", GA_API_SECRET: "" },
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await get("/api/config")).status === 200) return server;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  server.kill("SIGKILL");
  throw new Error("server did not start");
}

(async () => {
  const server = await startServer();
  try {
    const en = await get("/");
    const zh = await get("/zh/");
    assert.strictEqual(en.status, 200);
    assert.strictEqual(zh.status, 200);
    assert.match(en.body, /id="portfolio"/);
    assert.match(en.body, /Compress a design portfolio PDF/);
    assert.match(en.body, /<img[^>]+src="\/assets\/portfolio-cover\.webp"[^>]+alt="Design portfolio cover/);
    assert.match(en.body, /<img[^>]+src="\/assets\/portfolio-spread\.webp"[^>]+alt="Illustrative architecture portfolio spread/);
    assert.match(en.body, /class="portfolio-carousel"/);
    assert.match(en.body, /class="portfolio-stage"[\s\S]*class="portfolio-dots"[\s\S]*<\/div>\s*<\/div>\s*<p class="portfolio-caption"/);
    assert.match(en.body, /class="portfolio-slide"[^>]+src="\/assets\/portfolio-spread\.webp"[^>]+hidden/);
    assert.match(en.body, /class="portfolio-dot"[^>]+data-slide="0"[^>]+aria-pressed="true"/);
    assert.match(en.body, /class="portfolio-dot"[^>]+data-slide="1"[^>]+aria-pressed="false"/);
    assert.doesNotMatch(en.body, /class="portfolio-secondary"/);
    assert.match(en.body, /Try 10MB first/);
    assert.match(en.body, /class="portfolio-return" href="#compress-form"/);
    assert.match(zh.body, /id="portfolio"/);
    assert.match(zh.body, /设计作品集 PDF/);
    assert.match(zh.body, /先尝试 10MB/);
    assert.match(zh.body, /class="portfolio-carousel"/);
    assert.match(zh.body, /aria-label="展示作品集内页"/);
    assert.doesNotMatch(en.body, /href="\/compress-(?:pdf|portfolio|figma)/);

    for (const route of retired) {
      const response = await get(route);
      assert.strictEqual(response.status, 301, `${route} must permanently redirect`);
      assert.match(response.location, /^\/(?:zh\/)?#(?:portfolio|how-it-works|quality)$/, `${route} must point to relevant homepage content`);
      const htmlResponse = await get(`${route}.html`);
      assert.strictEqual(htmlResponse.status, 301, `${route}.html must not stay a duplicate page`);
    }
    const attributedRedirect = await get("/compress-portfolio-pdf?utm_source=medium&utm_campaign=portfolio");
    assert.strictEqual(attributedRedirect.location, "/?utm_source=medium&utm_campaign=portfolio#portfolio");

    const image = await get("/assets/portfolio-cover.webp");
    assert.strictEqual(image.status, 200);
    const secondImage = await get("/assets/portfolio-spread.webp");
    assert.strictEqual(secondImage.status, 200);

    const sitemap = await get("/sitemap.xml");
    const llms = await get("/llms.txt");
    assert.strictEqual(sitemap.status, 200);
    assert.match(sitemap.body, /<loc>https:\/\/tinypdf\.cn\/<\/loc>/);
    assert.match(sitemap.body, /<loc>https:\/\/tinypdf\.cn\/zh\/<\/loc>/);
    assert.doesNotMatch(sitemap.body, /<loc>https:\/\/tinypdf\.cn\/(?:zh\/)?compress-/);
    assert.doesNotMatch(llms.body, /https:\/\/tinypdf\.cn\/(?:zh\/)?compress-/);
    console.log("PASS - portfolio guidance lives on both homepages and duplicate routes consolidate safely");
  } finally {
    server.kill("SIGKILL");
  }
})().catch(error => {
  console.error(`FAIL - ${error.stack || error}`);
  process.exit(1);
});
