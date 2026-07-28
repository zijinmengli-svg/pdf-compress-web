"use strict";

const assert = require("assert");
const fsp = require("fs").promises;
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { readAnalyticsEvents, sourceFor, sourceCategoryFor } = require("../lib/analytics");

const SRV_DIR = path.join(__dirname, "..");
const PORT = 3922;
const REAL_UA = "Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36";
const CRAWLER_UA = "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)";
let passed = 0;
let failed = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function request(method, requestPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(body);
    const req = http.request({
      host: "127.0.0.1",
      port: PORT,
      path: requestPath,
      method,
      headers: {
        ...(payload ? { "Content-Length": payload.length } : {}),
        ...headers,
      },
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cookieValue(response, name) {
  const values = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"]
    : [response.headers["set-cookie"] || ""];
  const match = values.join("; ").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : "";
}

function navigationHeaders(extra = {}) {
  return {
    "User-Agent": REAL_UA,
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
    ...extra,
  };
}

function sameOriginHeaders(cookie, extra = {}) {
  return {
    "User-Agent": REAL_UA,
    Cookie: cookie,
    Origin: `http://127.0.0.1:${PORT}`,
    Referer: `http://127.0.0.1:${PORT}/`,
    "Sec-Fetch-Site": "same-origin",
    ...extra,
  };
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

async function startServer(analyticsFile) {
  const server = spawn("node", ["server-simple.js"], {
    cwd: SRV_DIR,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      ANALYTICS_FILE: analyticsFile,
      WEB_SESSION_SECRET: "integration-web-session-secret",
      GA_API_SECRET: "",
    },
  });

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await request("GET", "/api/config")).status === 200) return server;
    } catch {}
    await sleep(100);
  }
  server.kill("SIGKILL");
  throw new Error("server did not start");
}

(async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tinypdf-web-access-"));
  const analyticsFile = path.join(tempDir, "events.jsonl");
  const server = await startServer(analyticsFile);

  try {
    await check("direct compression calls are rejected before upload parsing", async () => {
      const response = await request("POST", "/api/jobs", "", {
        "User-Agent": REAL_UA,
        "Content-Type": "multipart/form-data; boundary=x",
      });
      assert.strictEqual(response.status, 403);
      assert.strictEqual(JSON.parse(response.body).code, "WEBSITE_SESSION_REQUIRED");
      assert.match(response.headers["x-robots-tag"] || "", /noindex/);
    });

    await check("AI crawler pages stay readable without receiving a website session", async () => {
      const response = await request("GET", "/", null, {
        "User-Agent": CRAWLER_UA,
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
      });
      assert.strictEqual(response.status, 200);
      assert.doesNotMatch(String(response.headers["set-cookie"] || ""), /tinypdf_web_session/);
      assert.doesNotMatch(String(response.headers["set-cookie"] || ""), /tinypdf_cid/);
    });

    await check("crawler tracking is acknowledged without persisting product events", async () => {
      const response = await request("POST", "/api/track", JSON.stringify({
        event: "page_view",
        referrer: "https://chatgpt.com/",
      }), {
        "User-Agent": CRAWLER_UA,
        "Content-Type": "application/json",
      });
      assert.strictEqual(response.status, 204);
      assert.deepStrictEqual(await readAnalyticsEvents(analyticsFile), []);
    });

    let ownedCookie = "";
    let ownedRequestToken = "";

    await check("real homepage navigation receives a signed session and request token", async () => {
      const page = await request("GET", "/?utm_medium=portfolio", null, navigationHeaders({
        Referer: "https://www.libindesign.cn/work/tinypdf?tracking=ignored",
      }));
      ownedCookie = cookieValue(page, "tinypdf_web_session");
      assert.ok(ownedCookie, "website-session cookie should be present");

      const config = await request("GET", "/api/config", null, sameOriginHeaders(ownedCookie));
      const payload = JSON.parse(config.body);
      ownedRequestToken = payload.webRequestToken;
      assert.ok(ownedRequestToken, "config should return a request token");
      assert.match(config.headers["x-robots-tag"] || "", /noarchive/);
    });

    await check("valid website session reaches existing upload validation", async () => {
      const response = await request("POST", "/api/jobs", "", sameOriginHeaders(ownedCookie, {
        "Content-Type": "multipart/form-data; boundary=x",
        "X-TinyPDF-Web-Token": ownedRequestToken,
      }));
      assert.strictEqual(response.status, 400);
      assert.strictEqual(JSON.parse(response.body).code, "BAD_REQUEST");
    });

    await check("signed libindesign attribution is persisted through accepted tracking", async () => {
      const response = await request("POST", "/api/track", JSON.stringify({
        event: "page_view",
        referrer: "",
        utm: {},
        data: { landingLanguage: "en" },
      }), sameOriginHeaders(ownedCookie, {
        "Content-Type": "application/json",
      }));
      assert.strictEqual(response.status, 200);
      const events = await readAnalyticsEvents(analyticsFile);
      assert.strictEqual(events.length, 1);
      assert.strictEqual(sourceFor(events[0]), "libindesign.cn");
      assert.strictEqual(sourceCategoryFor(events[0]), "owned_referral");
      assert.strictEqual(events[0].referrer, "https://www.libindesign.cn/work/tinypdf");
    });

    await check("direct visits stay Direct even when the tracking body spoofs libindesign", async () => {
      const page = await request("GET", "/", null, navigationHeaders());
      const directCookie = cookieValue(page, "tinypdf_web_session");
      assert.ok(directCookie);
      const response = await request("POST", "/api/track", JSON.stringify({
        event: "page_view",
        referrer: "https://libindesign.cn/fake",
        utm: {},
      }), sameOriginHeaders(directCookie, {
        "Content-Type": "application/json",
      }));
      assert.strictEqual(response.status, 200);
      const events = await readAnalyticsEvents(analyticsFile);
      assert.strictEqual(events.length, 2);
      assert.strictEqual(sourceFor(events[1]), "Direct");
      assert.strictEqual(sourceCategoryFor(events[1]), "direct");
      assert.strictEqual(events[1].referrer, "");
    });
  } finally {
    server.kill("SIGKILL");
    await fsp.rm(tempDir, { recursive: true, force: true });
  }

  console.log(`\nSUMMARY: ${passed}/${passed + failed} passed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(error => {
  console.log(`HARNESS ERROR: ${error.stack || error}`);
  process.exit(1);
});
