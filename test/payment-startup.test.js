"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startPaymentRuntime } = require("../lib/payment/startup");
test("startup remains closed without configuration and starts reconciliation after migrations", async () => {
  let migrated = false;
  let reconciled = 0;
  assert.equal(await startPaymentRuntime({ config: { ready: false } }), null);
  const runtime = await startPaymentRuntime({ config: { ready: true }, pool: {}, authService: {},
    migrate: async () => { migrated = true; }, makePaddle: () => ({}),
    makeRuntime: () => { assert.equal(migrated, true); return { worker: { processPendingWebhooks: async () => { reconciled++; } } }; },
  });
  assert.equal(reconciled, 1);
  runtime.stopReconciliation();
});
