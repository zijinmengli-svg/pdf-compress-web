"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = fs.promises;
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { validIndexNowKey, changedSitemapUrls, submitIndexNow } = require("../lib/indexnow");

const key = "abcDEF1234567890";
const sitemap = `<?xml version="1.0"?><urlset>
  <url><loc>https://tinypdf.cn/</loc><lastmod>2026-10-19</lastmod></url>
  <url><loc>https://tinypdf.cn/compress-portfolio-pdf</loc><lastmod>2026-10-19</lastmod></url>
  <url><loc>https://evil.example/page</loc><lastmod>2026-10-19</lastmod></url>
  <url><loc>http://tinypdf.cn/insecure</loc><lastmod>2026-10-19</lastmod></url>
  <url><loc>https://tinypdf.cn/old</loc><lastmod>2026-08-01</lastmod></url>
</urlset>`;

async function request(port, url) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: url }, res => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on("error", reject);
  });
}

async function serverWithKey(port, value) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "tinypdf-indexnow-"));
  const child = spawn(process.execPath, ["server-simple.js"], {
    cwd: path.join(__dirname, ".."), stdio: "ignore",
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", INDEXNOW_KEY: value, ANALYTICS_FILE: path.join(dir, "events.jsonl") },
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await request(port, "/api/config")).status === 200) return { child, dir }; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("server did not start");
}

(async () => {
  assert.strictEqual(validIndexNowKey(""), false);
  assert.strictEqual(validIndexNowKey("bad!key"), false);
  assert.strictEqual(validIndexNowKey("short"), false);
  assert.strictEqual(validIndexNowKey(key), true);
  assert.deepStrictEqual(changedSitemapUrls(sitemap, "2026-10-01"), [
    "https://tinypdf.cn/", "https://tinypdf.cn/compress-portfolio-pdf",
  ]);

  const calls = [];
  const submit = async (status) => submitIndexNow({ key, urls: changedSitemapUrls(sitemap, "2026-10-01"), fetcher: async (url, options) => {
    calls.push({ url, options });
    return { status };
  } });
  assert.strictEqual((await submit(200)).status, 200);
  assert.strictEqual((await submit(202)).status, 202);
  assert.strictEqual(calls[0].url, "https://api.indexnow.org/indexnow");
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), {
    host: "tinypdf.cn", key, keyLocation: `https://tinypdf.cn/${key}.txt`,
    urlList: ["https://tinypdf.cn/", "https://tinypdf.cn/compress-portfolio-pdf"],
  });
  await assert.rejects(submit(429), /rate limit/i);
  await assert.rejects(submitIndexNow({ key, urls: ["https://evil.example/"] }), /host/i);
  await assert.rejects(submitIndexNow({ key: "bad!", urls: ["https://tinypdf.cn/"] }), /key/i);
  await assert.rejects(submitIndexNow({ key, urls: ["https://tinypdf.cn/"], fetcher: async () => { throw new Error("offline"); } }), /network/i);

  const good = await serverWithKey(3831, key);
  try {
    const response = await request(3831, `/${key}.txt`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body, key);
    assert.ok(response.headers["content-type"].includes("text/plain"));
  } finally {
    good.child.kill("SIGKILL");
    await fsp.rm(good.dir, { recursive: true, force: true });
  }
  const bad = await serverWithKey(3832, "bad!key");
  try {
    assert.strictEqual((await request(3832, "/bad!key.txt")).status, 404);
  } finally {
    bad.child.kill("SIGKILL");
    await fsp.rm(bad.dir, { recursive: true, force: true });
  }
  console.log("IndexNow validation, submission, and key endpoint tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
