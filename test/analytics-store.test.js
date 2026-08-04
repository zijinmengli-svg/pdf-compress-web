"use strict";

const assert = require("assert");
const { newDb } = require("pg-mem");
const { createAnalyticsStore } = require("../lib/analytics-store");

(async () => {
  const db = newDb();
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  const store = createAnalyticsStore({ pool, filePath: "/unused/events.jsonl", explicitFilePath: false });

  await store.ready();
  const historical = {
    ts: "2026-08-04T02:00:00.000Z",
    event: "page_view",
    clientId: "visitor-1",
    data: {},
  };
  const firstImport = await store.importEvents([historical]);
  const retryImport = await store.importEvents([historical]);
  assert.deepStrictEqual(firstImport, { inserted: 1, skipped: 0 });
  assert.deepStrictEqual(retryImport, { inserted: 0, skipped: 1 });

  const events = await store.readAll();
  assert.strictEqual(events.length, 1, "a retry of the same event must not create a duplicate row");
  assert.strictEqual(events[0].event, "page_view");
  assert.strictEqual(events[0].clientId, "visitor-1");
  await store.close();
  console.log("analytics store test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
