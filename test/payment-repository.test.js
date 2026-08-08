"use strict";

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");
const { newDb, DataType } = require("pg-mem");
const {
  runPaymentMigrations,
  withTransaction,
} = require("../lib/payment/database");
const { createPaymentRepository } = require("../lib/payment/repository");

function fixture(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    publicTokenHash: crypto.randomBytes(32).toString("hex"),
    jobId: `job-${crypto.randomUUID()}`,
    anonymousIdentityHash: "anon-1",
    paymentStatus: "unpaid",
    fulfillmentStatus: "compressed",
    originalBytes: 5_000_000,
    targetBytes: 2_000_000,
    resultBytes: 1_900_000,
    reachedTarget: true,
    language: "en",
    country: "US",
    priceAmountMinor: 199,
    priceCurrency: "USD",
    source: "Direct",
    sourceCategory: "direct",
    sourceJson: {},
    compressedAt: new Date("2026-08-01T00:00:00.000Z"),
    expiresAt: new Date("2026-08-01T01:00:00.000Z"),
    ...overrides,
  };
}

async function makeRepository() {
  const db = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  db.public.registerFunction({
    name: "pg_advisory_lock",
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: () => true,
  });
  db.public.registerFunction({
    name: "pg_advisory_unlock",
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: () => true,
  });
  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  const migrationsDir = path.join(__dirname, "../db/migrations");
  await runPaymentMigrations(pool, migrationsDir);
  await runPaymentMigrations(pool, migrationsDir);
  const migrationRows = await pool.query("SELECT version FROM payment_schema_migrations");
  assert.deepStrictEqual(migrationRows.rows.map((row) => row.version), ["001_payment_schema.sql", "002_referral_rewards.sql"]);
  return { pool, repo: createPaymentRepository({ pool }) };
}

(async () => {
  const { pool, repo } = await makeRepository();
  const order = await repo.createOrder(fixture());
  assert.strictEqual(Number(order.price_amount_minor), 199);

  assert.strictEqual(await repo.consumeFreeGrant("anon-1", order.id, pool), true);
  assert.strictEqual(await repo.consumeFreeGrant("anon-1", order.id, pool), false);
  await repo.restoreFreeGrant("anon-1", order.id, "fulfillment_failed", pool);
  const replacement = await repo.createOrder(fixture({ anonymousIdentityHash: "anon-1" }));
  assert.strictEqual(await repo.consumeFreeGrant("anon-1", replacement.id, pool), true);

  const event = await repo.appendOrderEvent({
    id: crypto.randomUUID(),
    orderId: order.id,
    eventType: "order_created",
    source: "server",
    paymentStatus: "unpaid",
    fulfillmentStatus: "compressed",
    customerCurrency: "USD",
    occurredAt: new Date(),
  });
  assert.strictEqual(Number(event.revenue_delta_minor), 0);
  assert.strictEqual(event.revenue_delta_minor == null, false);

  await assert.rejects(
    repo.attachPaddleTransaction(order.id, "txn_duplicate", pool)
      .then(() => repo.attachPaddleTransaction(replacement.id, "txn_duplicate", pool)),
    /duplicate|unique/i,
  );

  assert.deepStrictEqual(await repo.enqueueWebhookReceipt({
    eventId: "evt_1",
    eventType: "transaction.completed",
    transactionId: "txn_1",
    payloadHash: "abc",
  }, pool), { inserted: true, status: "queued" });
  assert.deepStrictEqual(await repo.enqueueWebhookReceipt({
    eventId: "evt_1",
    eventType: "transaction.completed",
    transactionId: "txn_1",
    payloadHash: "abc",
  }, pool), { inserted: false, status: "queued" });

  await withTransaction(pool, async (tx) => {
    await repo.createFileObject({
      id: crypto.randomUUID(),
      orderId: order.id,
      provider: "r2",
      bucket: "private-results",
      objectKey: "orders/private-token.pdf",
      sizeBytes: 123,
      checksumSha256: "a".repeat(64),
      storedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }, tx);
  });
  const file = await repo.getActiveFileObject(order.id, pool);
  assert.strictEqual(file.object_key, "orders/private-token.pdf");
  assert.strictEqual(Object.hasOwn(file, "filename"), false);

  await repo.upsertFinancials(order.id, {
    transactionCurrency: "USD",
    customerSubtotalMinor: 199,
    customerDiscountMinor: 0,
    customerTaxMinor: 0,
    customerTotalMinor: 199,
    paddleFeeMinor: 20,
    transactionEarningsMinor: 179,
    payoutCurrency: "USD",
    payoutSubtotalMinor: 199,
    payoutTaxMinor: 0,
    payoutFeeMinor: 20,
    payoutEarningsMinor: 179,
    payoutExchangeRate: "1",
    adjustedPayoutEarningsMinor: 179,
    reconciledAt: new Date(),
  }, pool);
  const summary = await repo.paymentSummary({ from: new Date("2026-07-01"), to: new Date("2026-09-01") });
  assert.strictEqual(summary.netEarningsUsdMinor, 179);
  assert.deepStrictEqual(summary.customerTotalsByCurrency, { USD: 199 });

  await pool.end();
  console.log("payment repository tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
