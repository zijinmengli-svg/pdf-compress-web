"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { allowHostedSandbox } = require("../lib/payment/preview-gate");
const env = { TINYPDF_HOSTED_SANDBOX_TEST: "true", RENDER_SERVICE_ID: "srv-dbssv7tg1s2s73845m7g",
  RENDER_EXTERNAL_URL: "https://tinypdf-payment-qa.onrender.com" };
const config = { environment: "sandbox", enabled: true, ready: true, apiKey: "pdl_sdbx_apikey_fixture", clientToken: "test_fixture",
  databaseUrl: "postgresql://user:fake@dpg-dbsstge1egvs73epdj2g-a/tinypdf_test", notificationSettingId: "ntfset_01m7qqj9xfr52h0x79877v9g6z" };
test("hosted payment test gate only accepts the isolated service, database and sandbox credentials", () => {
  assert.equal(allowHostedSandbox(config, env), true);
  for (const update of [{ environment: "production" }, { enabled: false }, { ready: false },
    { apiKey: "pdl_live_apikey_fixture" }, { clientToken: "live_fixture" },
    { databaseUrl: "postgresql://user:fake@production.invalid/db" }, { notificationSettingId: "ntfset_wrong" }]) {
    assert.equal(allowHostedSandbox({ ...config, ...update }, env), false);
  }
  for (const update of [{ RENDER_SERVICE_ID: "srv-d9o4t88ae00c73anka80" },
    { RENDER_EXTERNAL_URL: "https://tinypdf.cn" }, { TINYPDF_HOSTED_SANDBOX_TEST: "" }]) {
    assert.equal(allowHostedSandbox(config, { ...env, ...update }), false);
  }
});
