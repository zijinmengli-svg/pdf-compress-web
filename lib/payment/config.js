"use strict";

const { assertMinor } = require("./money");

const REQUIRED_FIELDS = [
  "DATABASE_URL",
  "PADDLE_API_KEY",
  "PADDLE_CLIENT_TOKEN",
  "PADDLE_WEBHOOK_SECRET",
  "PADDLE_NOTIFICATION_SETTING_ID",
  "PADDLE_PRODUCT_ID",
  "PADDLE_PRICE_ID",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_ENDPOINT",
  "WEB_SESSION_SECRET",
  "PAYMENT_IDENTITY_HASH_SECRET",
];

function value(env, name) {
  return String(env[name] || "").trim();
}

function parseMinor(value, fallback) {
  const input = String(value || "").trim();
  if (!input) return fallback;

  const amount = Number(input);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : fallback;
}

function loadPaymentConfig(env = process.env) {
  const environment = env.PADDLE_ENVIRONMENT === "production" ? "production" : "sandbox";
  const required = environment === "production"
    ? [...REQUIRED_FIELDS, "PUBLIC_OPERATOR_LEGAL_NAME"]
    : REQUIRED_FIELDS;
  const missing = required.filter((name) => !value(env, name));
  const requested = env.BILLING_ENABLED === "true";

  return {
    requested,
    enabled: requested && missing.length === 0,
    ready: missing.length === 0,
    missing,
    environment,
    usdAmountMinor: parseMinor(env.PAYMENT_USD_MINOR, 199),
    cnyAmountMinor: parseMinor(env.PAYMENT_CNY_MINOR, 990),
    databaseUrl: value(env, "DATABASE_URL"),
    apiKey: value(env, "PADDLE_API_KEY"),
    clientToken: value(env, "PADDLE_CLIENT_TOKEN"),
    webhookSecret: value(env, "PADDLE_WEBHOOK_SECRET"),
    notificationSettingId: value(env, "PADDLE_NOTIFICATION_SETTING_ID"),
    productId: value(env, "PADDLE_PRODUCT_ID"),
    priceId: value(env, "PADDLE_PRICE_ID"),
    r2AccountId: value(env, "R2_ACCOUNT_ID"),
    r2AccessKeyId: value(env, "R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: value(env, "R2_SECRET_ACCESS_KEY"),
    r2Bucket: value(env, "R2_BUCKET"),
    r2Endpoint: value(env, "R2_ENDPOINT"),
    webSessionSecret: value(env, "WEB_SESSION_SECRET"),
    identityHashSecret: value(env, "PAYMENT_IDENTITY_HASH_SECRET"),
    operatorLegalName: value(env, "PUBLIC_OPERATOR_LEGAL_NAME"),
  };
}

function formatMinor(amountMinor, symbol) {
  const amount = assertMinor(amountMinor, "amountMinor");
  return `${symbol}${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;
}

function publicPaymentConfig(config, settings, health) {
  const usdAmountMinor = assertMinor(settings.usdAmountMinor, "usdAmountMinor");
  const cnyAmountMinor = assertMinor(settings.cnyAmountMinor, "cnyAmountMinor");
  const ready = Boolean(health && health.ready);

  return {
    enabled: Boolean(config.enabled && settings.billingEnabled),
    environment: config.environment,
    clientToken: config.clientToken,
    usdAmountMinor,
    cnyAmountMinor,
    usdDisplay: formatMinor(usdAmountMinor, "$"),
    cnyDisplay: formatMinor(cnyAmountMinor, "¥"),
    status: ready ? "ready" : "unavailable",
  };
}

module.exports = {
  loadPaymentConfig,
  publicPaymentConfig,
};
