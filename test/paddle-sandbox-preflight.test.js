"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkIsolation } = require("../scripts/check-paddle-sandbox");

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
