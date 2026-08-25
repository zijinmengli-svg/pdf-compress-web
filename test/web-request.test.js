"use strict";

const assert = require("assert");
const { postCompressionWithSession } = require("../public/web-request.js");

async function run() {
  let attempts = 0;
  let refreshed = 0;
  const responses = [
    { ok: false, status: 403, json: async () => ({ code: "WEBSITE_SESSION_REQUIRED" }) },
    { ok: true, status: 200, json: async () => ({ id: "job-1" }) },
  ];

  const result = await postCompressionWithSession({
    body: new FormData(),
    getToken: () => attempts === 0 ? "stale-token" : "fresh-token",
    refreshToken: async () => {
      refreshed++;
      return "fresh-token";
    },
    fetchImpl: async (_url, options) => {
      attempts++;
      assert.strictEqual(options.headers["X-TinyPDF-Web-Token"], attempts === 1 ? "stale-token" : "fresh-token");
      return responses.shift();
    },
  });

  assert.strictEqual(result.response.ok, true);
  assert.deepStrictEqual(result.payload, { id: "job-1" });
  assert.strictEqual(attempts, 2);
  assert.strictEqual(refreshed, 1);
  console.log("PASS - compression retries once after website session renewal");
}

run().then(() => {
  console.log("\nSUMMARY: 1/1 passed");
}).catch(error => {
  console.log(`FAIL - compression retries once after website session renewal :: ${error.message}`);
  process.exitCode = 1;
});
