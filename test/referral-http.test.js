"use strict";

const assert = require("assert");
const http = require("http");
const { newDb, DataType } = require("pg-mem");
const path = require("path");

process.env.WEB_SESSION_SECRET = "referral-http-session-secret";
process.env.ADMIN_SESSION_SECRET = "referral-http-admin-secret";
process.env.ADMIN_PASSWORD = "referral-http-admin-password";

const { runPaymentMigrations } = require("../lib/payment/database");
const { createReferralRepository } = require("../lib/referral/repository");
const { createCreditService } = require("../lib/referral/credit-service");
const { createReferralService } = require("../lib/referral/service");
const serverModule = require("../server-simple");

function request(port, pathname, headers = {}, body = null, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: pathname, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function cookieHeader(response) {
  return (response.headers["set-cookie"] || []).map((value) => value.split(";", 1)[0]).join("; ");
}

async function makeRuntime() {
  const db = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  db.public.registerFunction({ name: "pg_advisory_lock", args: [DataType.bigint], returns: DataType.bool, implementation: () => true });
  db.public.registerFunction({ name: "pg_advisory_unlock", args: [DataType.bigint], returns: DataType.bool, implementation: () => true });
  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  await runPaymentMigrations(pool, path.join(__dirname, "../db/migrations"));
  const repo = createReferralRepository({ pool });
  await repo.updateSettings({ enabled: true, dailyRewardCap: 50 }, pool);
  const credits = createCreditService({ repo, pool });
  const service = createReferralService({ repo, creditService: credits, secret: process.env.WEB_SESSION_SECRET, origin: "http://127.0.0.1" });
  return { pool, repo, credits, service, config: { walletSecret: process.env.WEB_SESSION_SECRET, walletCookieDays: 365 } };
}

async function main() {
  const referral = await makeRuntime();
  serverModule.setTestRuntimes({ referral, payment: null });
  const server = serverModule.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const pageHeaders = { Host: `127.0.0.1:${port}`, "User-Agent": "Mozilla/5.0 Chrome/126", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" };
  const firstPage = await request(port, "/", pageHeaders);
  assert.strictEqual(firstPage.statusCode, 200);
  const firstCookies = cookieHeader(firstPage);
  assert.match(firstCookies, /tinypdf_web_session=/);
  assert.match(firstCookies, /tinypdf_reward_wallet=/);

  const sameOrigin = { ...pageHeaders, Cookie: firstCookies, "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin", Referer: `http://127.0.0.1:${port}/` };
  const firstStatus = await request(port, "/api/referral/status?language=en", sameOrigin);
  assert.strictEqual(firstStatus.statusCode, 200);
  const firstPayload = JSON.parse(firstStatus.body.toString("utf8"));
  assert.strictEqual(firstPayload.enabled, true);
  assert.match(firstPayload.shareUrl, /[?&]ref=/);
  assert.doesNotMatch(firstStatus.body.toString("utf8"), /walletHash|wallet-a/);

  const referralUrl = new URL(firstPayload.shareUrl);
  const secondPage = await request(port, `/?ref=${encodeURIComponent(referralUrl.searchParams.get("ref"))}`, pageHeaders);
  assert.strictEqual(secondPage.statusCode, 200);
  const refs = await referral.repo.listAdminEvents({}, referral.pool);
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].status, "opened");

  const trackBody = JSON.stringify({ event: "referral_share_clicked", language: "en" });
  const track = await request(port, "/api/referral/track", { ...sameOrigin, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(trackBody) }, trackBody, "POST");
  assert.strictEqual(track.statusCode, 200);

  const loginBody = JSON.stringify({ password: process.env.ADMIN_PASSWORD });
  const login = await request(port, "/api/admin/login", { ...pageHeaders, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(loginBody) }, loginBody, "POST");
  assert.strictEqual(login.statusCode, 200);
  const adminCookie = cookieHeader(login);
  const adminHeaders = { Host: `127.0.0.1:${port}`, Cookie: adminCookie, "Sec-Fetch-Site": "same-origin", Origin: `http://127.0.0.1:${port}`, "Content-Type": "application/json" };
  const adminData = await request(port, "/api/admin/referrals", adminHeaders);
  assert.strictEqual(adminData.statusCode, 200);
  const adminPayload = JSON.parse(adminData.body.toString("utf8"));
  assert.strictEqual(adminPayload.available, true);
  assert.strictEqual(adminPayload.settings.enabled, true);
  assert.strictEqual(adminPayload.events[0].status, "opened");
  const settingsBody = JSON.stringify({ enabled: false, dailyRewardCap: 25 });
  const saveSettings = await request(port, "/api/admin/referrals/settings", { ...adminHeaders, "Content-Length": Buffer.byteLength(settingsBody) }, settingsBody, "POST");
  assert.strictEqual(saveSettings.statusCode, 200);
  assert.strictEqual(JSON.parse(saveSettings.body.toString("utf8")).settings.enabled, false);

  server.close();
  await referral.pool.end();
  console.log("referral HTTP tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
