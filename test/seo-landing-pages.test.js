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
      assert.match(response.body, /src="\/app-simple\.js\?v=2\.0\.1"/);
    }

    const homepage = await get("/");
    const sitemap = await get("/sitemap.xml");
    const llms = await get("/llms.txt");

    for (const page of PAGES) {
      assert.match(homepage.body, new RegExp(`href="${page.path}"`));
      assert.match(sitemap.body, new RegExp(`<loc>https://tinypdf\\.cn${page.path}</loc>`));
      assert.match(llms.body, new RegExp(`https://tinypdf\\.cn${page.path}`));
    }

    console.log("PASS - five target-size pages are crawlable, usable, and internally discoverable");
  } finally {
    server.kill("SIGKILL");
  }
})().catch(error => {
  console.error(`FAIL - ${error.stack || error}`);
  process.exit(1);
});
