"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkIsolation, checkPrice } = require("../scripts/check-paddle-sandbox");

const testOrigin = "https://preview.example.test";
const checkoutUrl = testOrigin + "/buy";
const fixture = {
  active: true, type: "url", destination: testOrigin + "/api/paddle/webhook", traffic_source: "platform",
  subscribed_events: [{ name: "transaction.completed" }, { name: "adjustment.updated" }],
};
test("sandbox preflight permits only the dedicated preview destination and checkout URL", () => {
  const check = (destinations, extra = {}) => checkIsolation({ destinations, testOrigin, checkoutUrl, ...extra });
  assert.deepEqual(check([fixture]), []);
  assert.deepEqual(check([fixture, { ...fixture, traffic_source: "simulation", destination: "https://tinypdf.cn/api/paddle/webhook" }]), []);
  assert.ok(check([fixture, { ...fixture, destination: "https://tinypdf.cn/api/paddle/webhook" }]).some(issue => issue.includes("production")));
  assert.ok(check([fixture], { hasMore: true }).length);
  assert.ok(check([fixture], { checkoutUrl: null }).some(issue => issue.includes("unset")));
  assert.ok(check([{ ...fixture, subscribed_events: [] }]).some(issue => issue.includes("adjustment.updated")));
  assert.throws(() => check([fixture], { testOrigin: "https://www.tinypdf.cn" }));
});

test("catalog preflight rejects a one-unit-only price before multi-pack checkout", () => {
  const price = { id: "pri_fixture", product_id: "pro_fixture", status: "active", billing_cycle: null,
    quantity: { minimum: 1, maximum: 10 }, unit_price: { amount: "199", currency_code: "USD" },
    unit_price_overrides: [{ country_codes: ["CN"], unit_price: { amount: "990", currency_code: "CNY" } }] };
  const check = (extra = {}) => checkPrice({ price: { ...price, ...extra }, priceId: "pri_fixture", productId: "pro_fixture" });
  assert.deepEqual(check(), []);
  assert.ok(check({ quantity: { minimum: 1, maximum: 1 } }).some(issue => issue.includes("1/3/5/10")));
  assert.ok(check({ quantity: { minimum: 3, maximum: 10 } }).length);
  assert.ok(check({ status: "archived" }).length);
  assert.ok(check({ billing_cycle: { interval: "month", frequency: 1 } }).length);
  assert.ok(check({ product_id: "pro_wrong" }).length);
  assert.ok(check({ unit_price: { amount: "990", currency_code: "USD" } }).length);
  assert.ok(check({ unit_price_overrides: [] }).length);
});
