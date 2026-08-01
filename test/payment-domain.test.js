"use strict";

const assert = require("assert");
const {
  loadPaymentConfig,
  publicPaymentConfig,
} = require("../lib/payment/config");
const { assertMinor, money, financialDelta } = require("../lib/payment/money");
const {
  hashAnonymousIdentity,
  createOrderCapability,
  hashOrderCapability,
  verifyOrderCapability,
} = require("../lib/payment/security");

const env = {
  BILLING_ENABLED: "true",
  PADDLE_ENVIRONMENT: "sandbox",
  PADDLE_API_KEY: "pdl_sdbx_apikey_test",
  PADDLE_CLIENT_TOKEN: "test_client_token",
  PADDLE_WEBHOOK_SECRET: "pdl_ntfset_test",
  PADDLE_NOTIFICATION_SETTING_ID: "ntfset_123",
  PADDLE_PRODUCT_ID: "pro_123",
  PADDLE_PRICE_ID: "pri_123",
  PAYMENT_USD_MINOR: "199",
  PAYMENT_CNY_MINOR: "990",
  DATABASE_URL: "postgres://example",
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "access",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "tinypdf-paid-results",
  R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  WEB_SESSION_SECRET: "stable-web-session-secret",
  PAYMENT_IDENTITY_HASH_SECRET: "stable-payment-identity-hash-secret",
};

// Break caught: config accidentally enables billing without its complete server-side setup.
const cfg = loadPaymentConfig(env);
assert.strictEqual(cfg.ready, true);
assert.strictEqual(cfg.enabled, true);
assert.deepStrictEqual(publicPaymentConfig(cfg, {
  billingEnabled: true,
  usdAmountMinor: 199,
  cnyAmountMinor: 990,
}, { ready: true }), {
  enabled: true,
  environment: "sandbox",
  clientToken: "test_client_token",
  usdAmountMinor: 199,
  cnyAmountMinor: 990,
  usdDisplay: "$1.99",
  cnyDisplay: "¥9.90",
  status: "ready",
});
assert.strictEqual(Object.hasOwn(publicPaymentConfig(cfg, {
  billingEnabled: true,
  usdAmountMinor: 199,
  cnyAmountMinor: 990,
}, { ready: true }), "apiKey"), false);
assert.strictEqual(loadPaymentConfig({ BILLING_ENABLED: "true" }).enabled, false);

// Break caught: malformed configured amounts silently fall back to sale prices.
for (const [name, invalidValue] of [
  ["PAYMENT_USD_MINOR", "1.5"],
  ["PAYMENT_CNY_MINOR", "0"],
  ["PAYMENT_USD_MINOR", "1e2"],
]) {
  const invalidAmountConfig = loadPaymentConfig({ ...env, [name]: invalidValue });
  assert.strictEqual(invalidAmountConfig.ready, false);
  assert.strictEqual(invalidAmountConfig.enabled, false);
  assert.strictEqual(invalidAmountConfig[name === "PAYMENT_USD_MINOR"
    ? "usdAmountMinor"
    : "cnyAmountMinor"], undefined);
  assert.strictEqual(invalidAmountConfig.errors.some((error) => error.startsWith(name)), true);
}

const defaultAmountConfig = loadPaymentConfig({
  ...env,
  PAYMENT_USD_MINOR: " ",
  PAYMENT_CNY_MINOR: "",
});
assert.strictEqual(defaultAmountConfig.ready, true);
assert.deepStrictEqual(defaultAmountConfig.errors, []);
assert.strictEqual(defaultAmountConfig.usdAmountMinor, 199);
assert.strictEqual(defaultAmountConfig.cnyAmountMinor, 990);

// Break caught: checkout is advertised even though payment health is not ready.
assert.strictEqual(publicPaymentConfig(cfg, {
  billingEnabled: true,
  usdAmountMinor: 199,
  cnyAmountMinor: 990,
}, { ready: false }).enabled, false);

// Break caught: production starts without the legal operator name required for Terms.
const productionConfig = loadPaymentConfig({
  ...env,
  PADDLE_ENVIRONMENT: "production",
  PUBLIC_OPERATOR_LEGAL_NAME: "  TinyPDF Ltd.  ",
});
assert.strictEqual(productionConfig.ready, true);
assert.strictEqual(productionConfig.operatorLegalName, "TinyPDF Ltd.");
assert.strictEqual(loadPaymentConfig({
  ...env,
  PADDLE_ENVIRONMENT: "production",
}).ready, false);

// Break caught: fractional or invalid monetary minor units reach accounting code.
assert.throws(() => assertMinor(1.5, "amount"), /integer/);
assert.deepStrictEqual(money(199, "usd"), { amountMinor: 199, currency: "USD" });
assert.strictEqual(financialDelta(139, 20), -119);

// Break caught: anonymous identities become unstable or capabilities are not safely verifiable.
const hash = hashAnonymousIdentity("session-1", "secret");
assert.strictEqual(hash, hashAnonymousIdentity("session-1", "secret"));
assert.notStrictEqual(hash, hashAnonymousIdentity("session-2", "secret"));
const capability = createOrderCapability();
assert.strictEqual(capability.token.length, 43);
assert.strictEqual(capability.tokenHash, hashOrderCapability(capability.token));
assert.strictEqual(verifyOrderCapability(capability.token, capability.tokenHash), true);
assert.strictEqual(verifyOrderCapability(createOrderCapability().token, capability.tokenHash), false);
assert.strictEqual(verifyOrderCapability("malformed", capability.tokenHash), false);

console.log("payment domain tests passed");
