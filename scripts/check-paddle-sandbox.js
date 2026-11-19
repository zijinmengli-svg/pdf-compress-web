"use strict";
// Read-only release preflight. Never prints API keys, webhook secrets or URL paths.
const SANDBOX_API = "https://sandbox-api.paddle.com";
const REQUIRED_EVENTS = ["transaction.completed", "adjustment.updated"];

function checkPrice({ price, priceId, productId }) {
  const problems = [];
  if (!price || price.id !== priceId || price.product_id !== productId || price.status !== "active") {
    return ["The configured sandbox price must be active and belong to the configured product."];
  }
  if (price.billing_cycle !== null) problems.push("Compression credits must use a one-time price.");
  const range = price.quantity;
  if (!Number.isSafeInteger(range?.minimum) || !Number.isSafeInteger(range?.maximum) ||
      range.minimum > 1 || range.maximum < 10) {
    problems.push("The sandbox price quantity range must support all 1/3/5/10 packs.");
  }
  if (price.unit_price?.amount !== "199" || price.unit_price?.currency_code !== "USD") {
    problems.push("The USD base price must be 199 minor per compression.");
  }
  const cn = price.unit_price_overrides?.filter(row => row.country_codes?.includes("CN")) || [];
  if (cn.length !== 1 || cn[0].unit_price?.amount !== "990" || cn[0].unit_price?.currency_code !== "CNY") {
    problems.push("Mainland China must have exactly one CNY 990 minor unit-price override.");
  }
  return problems;
}

function checkIsolation({ destinations, hasMore, checkoutUrl, testOrigin }) {
  const problems = [];
  const test = testOrigin ? new URL(testOrigin) : null;
  const production = host => host === "tinypdf.cn" || host.endsWith(".tinypdf.cn");
  if (test && (test.protocol !== "https:" || test.origin !== testOrigin || production(test.hostname))) {
    throw new Error("Use the exact isolated HTTPS preview origin, with no path or trailing slash");
  }
  if (hasMore) problems.push("Notification list is incomplete; isolation cannot be verified.");
  const platform = destinations.filter(d => d.active && ["platform", "all"].includes(d.traffic_source));
  const callbacks = platform.filter(d => d.type === "url" && test &&
    new URL(d.destination).origin === test.origin && new URL(d.destination).pathname === "/api/paddle/webhook");
  if (platform.some(d => d.type === "url" && production(new URL(d.destination).hostname))) {
    problems.push("An active sandbox transaction destination points to the production site.");
  }
  if (!test) problems.push("No isolated HTTPS preview origin supplied.");
  if (test && (callbacks.length !== 1 || platform.length !== 1)) {
    problems.push("Expected exactly one active platform destination, on the isolated preview webhook.");
  }
  if (callbacks.length === 1 && !REQUIRED_EVENTS.every(type => callbacks[0].subscribed_events.some(event => event.name === type))) {
    problems.push("The preview webhook must receive transaction.completed and adjustment.updated.");
  }
  if (!checkoutUrl) problems.push("The sandbox default payment link is unset.");
  else if (test && new URL(checkoutUrl).origin !== test.origin) problems.push("The sandbox default payment link points outside the isolated preview.");
  return problems;
}

async function main() {
  const key = process.env.PADDLE_API_KEY;
  if (!key?.startsWith("pdl_sdbx_apikey_") || process.env.PADDLE_ENVIRONMENT !== "sandbox") {
    throw new Error("Only a sandbox key and PADDLE_ENVIRONMENT=sandbox are permitted");
  }
  async function get(path) {
    const response = await fetch(SANDBOX_API + path, {
      headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Sandbox GET ${path} returned HTTP ${response.status}`);
    return response.json();
  }
  const priceId = process.env.PADDLE_PRICE_ID;
  const productId = process.env.PADDLE_PRODUCT_ID;
  if (!/^pri_[a-z0-9]+$/.test(priceId || "") || !/^pro_[a-z0-9]+$/.test(productId || "")) {
    throw new Error("Configured sandbox product and price IDs are required");
  }
  const [notifications, settings, price] = await Promise.all([get("/notification-settings?active=true"),
    get("/settings/checkout-url"), get(`/prices/${priceId}`)]);
  const problems = checkIsolation({ destinations: notifications.data, hasMore: notifications.meta?.pagination?.has_more !== false,
    checkoutUrl: settings.data.default_url, testOrigin: process.env.TINYPDF_PADDLE_TEST_ORIGIN });
  problems.push(...checkPrice({ price: price.data, priceId, productId }));
  if (problems.length) {
    for (const problem of problems) console.error(`BLOCKED: ${problem}`);
    process.exitCode = 1;
  } else console.log("PASS: sandbox notifications and default payment link are isolated; one-time pricing supports 1/3/5/10 packs. No transaction was created.");
}

if (require.main === module) main().catch(error => {
  console.error("Sandbox preflight could not verify configuration:", /^(Sandbox GET |Only a sandbox |Use the exact )/.test(error.message) ? error.message : error.name);
  process.exitCode = 1;
});
module.exports = { checkIsolation, checkPrice };
