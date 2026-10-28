"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { newDb } = require("pg-mem");
const { createPrepaidWebhookRepository } = require("../lib/payment/prepaid-webhook-repository");

async function setup() {
  const db = newDb({ noAstCoverageCheck: true });
  const pool = new (db.adapters.createPg().Pool)();
  await pool.query(`CREATE TABLE prepaid_webhook_receipts (
    event_id text PRIMARY KEY, event_type text NOT NULL, transaction_id text, resource_id text,
    payload_hash text NOT NULL, processing_status text NOT NULL DEFAULT 'queued',
    processing_attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_expires_at timestamptz, safe_error text NOT NULL DEFAULT '',
    received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz)`);
  return { pool, repo: createPrepaidWebhookRepository({ now: () => new Date("2026-10-28T00:00:00Z") }) };
}

test("webhook repository deduplicates events and completes one claimed receipt", async () => {
  const { pool, repo } = await setup();
  const input = { eventId: "evt_one", eventType: "transaction.completed", transactionId: "txn_one", payloadHash: "hash" };
  assert.deepEqual(await repo.enqueueWebhookReceipt(input, pool), { inserted: true });
  // pg-mem returns the pre-existing row for ON CONFLICT DO NOTHING RETURNING;
  // PostgreSQL returns no row. Verify storage here and the result contract below.
  await repo.enqueueWebhookReceipt(input, pool);
  assert.equal((await pool.query("SELECT count(*) AS count FROM prepaid_webhook_receipts")).rows[0].count, 1);
  const receipts = await repo.claimWebhookReceipts(5, new Date("2026-10-28T00:01:00Z"), pool);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].event_id, "evt_one");
  assert.deepEqual(await repo.claimWebhookReceipts(5, new Date("2026-10-28T00:01:00Z"), pool), []);
  await repo.completeWebhookReceipt("evt_one", { message: "processed" }, pool);
  assert.equal((await pool.query("SELECT processing_status FROM prepaid_webhook_receipts WHERE event_id = $1", ["evt_one"])).rows[0].processing_status, "processed");
  assert.deepEqual(await repo.claimWebhookReceipts(5, new Date("2026-10-28T00:02:00Z"), pool), []);
  await pool.end();
});

test("duplicate receipt reports inserted false when PostgreSQL returns no row", async () => {
  const repo = createPrepaidWebhookRepository();
  const db = { query: async () => ({ rows: [] }) };
  assert.deepEqual(await repo.enqueueWebhookReceipt({ eventId: "evt_duplicate", eventType: "transaction.completed", payloadHash: "hash" }, db), { inserted: false });
});

test("failed receipt retries after delay; expired leases can be reclaimed", async () => {
  const { pool, repo } = await setup();
  await repo.enqueueWebhookReceipt({ eventId: "evt_retry", eventType: "transaction.completed", transactionId: "txn_retry", payloadHash: "hash" }, pool);
  assert.equal((await repo.claimWebhookReceipts(1, new Date("2026-10-28T00:01:00Z"), pool)).length, 1);
  await repo.retryWebhookReceipt("evt_retry", "safe_failure", new Date("2026-10-28T00:05:00Z"), pool);
  assert.equal((await pool.query("SELECT processing_attempts FROM prepaid_webhook_receipts WHERE event_id = 'evt_retry'")).rows[0].processing_attempts, 1);
  assert.deepEqual(await repo.claimWebhookReceipts(1, new Date("2026-10-28T00:01:00Z"), pool), []);
  const futureRepo = createPrepaidWebhookRepository({ now: () => new Date("2026-10-28T00:05:01Z") });
  assert.equal((await futureRepo.claimWebhookReceipts(1, new Date("2026-10-28T00:06:00Z"), pool)).length, 1);
  const expiredRepo = createPrepaidWebhookRepository({ now: () => new Date("2026-10-28T00:06:01Z") });
  assert.equal((await expiredRepo.claimWebhookReceipts(1, new Date("2026-10-28T00:07:00Z"), pool)).length, 1);
  await pool.end();
});
