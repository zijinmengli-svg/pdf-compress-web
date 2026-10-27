"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadPaymentConfig } = require("../lib/payment/config");

function env(overrides = {}) {
  return { DATABASE_URL: "postgresql://sandbox.invalid/test", PADDLE_API_KEY: "pdl_sdbx_apikey_placeholder",
    PADDLE_CLIENT_TOKEN: "test_placeholder", PADDLE_WEBHOOK_SECRET: "ntf_secret_placeholder",
    PADDLE_NOTIFICATION_SETTING_ID: "ntfset_placeholder", PADDLE_PRODUCT_ID: "pro_placeholder",
    PADDLE_PRICE_ID: "pri_placeholder", WEB_SESSION_SECRET: "session-placeholder",
    PAYMENT_IDENTITY_HASH_SECRET: "identity-placeholder", PADDLE_ENVIRONMENT: "sandbox", BILLING_ENABLED: "false", ...overrides };
}

test("billing stays off with valid sandbox configuration until explicitly enabled", () => {
  const config = loadPaymentConfig(env());
  assert.equal(config.ready, true);
  assert.equal(config.enabled, false);
  assert.equal(loadPaymentConfig(env({ BILLING_ENABLED: "true" })).enabled, true);
});

test("missing environment or mixed live credentials never enable billing", () => {
  for (const overrides of [{ PADDLE_ENVIRONMENT: "" }, { PADDLE_API_KEY: "pdl_live_apikey_wrong" },
    { PADDLE_CLIENT_TOKEN: "live_wrong" }, { PADDLE_WEBHOOK_SECRET: "" }]) {
    const config = loadPaymentConfig(env({ BILLING_ENABLED: "true", ...overrides }));
    assert.equal(config.enabled, false);
    assert.equal(config.ready, false);
  }
});
