"use strict";
// Explicit opt-in integration test. Never connect to a production/remote database.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { Pool } = require("pg");
const { runPrepaidMigrations } = require("../lib/payment/database");
const { createPrepaidLedger } = require("../lib/payment/prepaid-ledger");
const { createCompressionQuota } = require("../lib/payment/compression-quota");

async function main() {
  const connectionString = process.env.PAYMENT_TEST_DATABASE_URL;
  if (!connectionString) throw new Error("Set PAYMENT_TEST_DATABASE_URL to an isolated local test database");
  const url = new URL(connectionString);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      !/^\/tinypdf_test(?:_[a-z0-9_]+)?$/.test(url.pathname) || url.search) {
    throw new Error("Only a local tinypdf_test database without URL options is permitted");
  }
  const schema = `payment_test_${crypto.randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  let pool;
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    pool = new Pool({ connectionString, max: 12, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
    await pool.query(fs.readFileSync(require.resolve("../lib/auth/schema.sql"), "utf8"));
    await runPrepaidMigrations(pool);
    await runPrepaidMigrations(pool);
    let instant = new Date("2026-11-11T17:59:59.000Z");
    const now = () => new Date(instant);
    const burst = (fn) => Promise.all(Array.from({ length: 100 }, (_, i) => fn(i)));
    const started = performance.now();
    let ledger = createPrepaidLedger({ pool, now });
    const walletHash = "concurrent-test";
    await burst(() => ledger.ensureDailyFreeCredit({ walletHash }));
    assert.equal((await ledger.getBalance({ walletHash })).available, 1);
    const results = await burst(i => ledger.reserveJob({ walletHash, jobId: `job-${i}` }));
    assert.equal(results.filter(result => result.reserved).length, 1);
    const winner = `job-${results.findIndex(result => result.reserved)}`;
    await burst(() => ledger.finishJob({ walletHash, jobId: winner, success: false }));
    assert.equal((await ledger.getBalance({ walletHash })).available, 1);
    await ledger.reserveJob({ walletHash, jobId: "persisted-job" });
    await pool.end();
    pool = new Pool({ connectionString, max: 12, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
    ledger = createPrepaidLedger({ pool, now });
    assert.equal((await ledger.getBalance({ walletHash })).available, 0);
    await burst(() => ledger.finishJob({ walletHash, jobId: "persisted-job", success: true }));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM reward_ledger_events WHERE event_type='spent'")).rows[0].n, 1);
    assert.equal((await ledger.reserveJob({ walletHash, jobId: "blocked-second" })).reserved, false);
    const wallet = await ledger.ensureWallet({ walletHash });
    await burst(() => ledger.grantPurchasedCredit({ walletId: wallet.id, transactionId: "txn_acceptance", quantity: 3, expiresAt: new Date("2027-11-12T00:00:00Z") }));
    assert.equal((await ledger.getBalance({ walletHash })).available, 3);
    assert.equal((await ledger.reserveJob({ walletHash, jobId: "paid-second" })).reserved, true);
    await ledger.finishJob({ walletHash, jobId: "paid-second", success: true });
    assert.equal((await ledger.getBalance({ walletHash })).available, 2);
    instant = new Date("2026-11-11T18:00:00.000Z");
    const refresh = await burst(() => ledger.ensureDailyFreeCredit({ walletHash }));
    assert.equal(refresh.filter(row => row.granted).length, 1);
    assert.equal(refresh[0].resetsAt, "2026-11-12T18:00:00.000Z");
    assert.equal((await ledger.getBalance({ walletHash })).available, 3);
    instant = new Date("2026-11-13T18:00:00.000Z");
    await ledger.ensureDailyFreeCredit({ walletHash });
    assert.equal((await ledger.getBalance({ walletHash })).available, 3);
    instant = new Date("2026-11-14T17:59:59.000Z");
    const quota = createCompressionQuota({ pool, ledger, now: () => instant.getTime() });
    const identity = { guestHash: "qa-device", accountId: "qa-account", walletHash };
    const guest = { guestHash: identity.guestHash };
    const attempts = await burst(i => quota.reserve(i % 2 ? identity : guest, `quota-${i}`));
    assert.equal(attempts.filter(row => row?.kind === "free").length, 1);
    assert.equal(attempts.filter(row => row?.kind === "paid").length, 2);
    await Promise.all(attempts.filter(Boolean).map(row => quota.finish(row, false)));
    assert.equal((await quota.balance(identity)).available, 3);
    const first = await quota.reserve(identity, "quota-first");
    assert.equal(first.kind, "free");
    await quota.finish(first, true);
    assert.equal((await quota.balance(guest)).available, 0);
    assert.equal((await quota.balance({ ...identity, guestHash: "other-device" })).free, 0);
    assert.equal((await quota.balance({ ...identity, accountId: "other-account" })).free, 0);
    const second = await quota.reserve(identity, "quota-second");
    assert.equal(second.kind, "paid");
    await quota.finish(second, true);
    assert.equal((await quota.balance(identity)).available, 1);
    instant = new Date("2026-11-14T18:00:00.000Z");
    assert.deepEqual(await quota.balance(identity), { available: 2, free: 1, paid: 1, resetsAt: "2026-11-15T18:00:00.000Z", timezone: "Asia/Shanghai" });
    instant = new Date("2026-11-16T18:00:00.000Z");
    assert.equal((await quota.balance(identity)).available, 2);
    const leaseMs = 60_000;
    const quotaWithRecovery = (db) => createCompressionQuota({
      pool: db, ledger: createPrepaidLedger({ pool: db, now }), now: () => instant.getTime(), leaseMs,
    });
    const beforeCrash = quotaWithRecovery(pool);
    const abandonedFree = await beforeCrash.reserve(identity, "abandoned-free");
    const abandonedPaid = await beforeCrash.reserve(identity, "abandoned-paid");
    assert.equal(abandonedFree.kind, "free");
    assert.equal(abandonedPaid.kind, "paid");
    assert.equal((await beforeCrash.balance(identity)).available, 0);
    const completedGuest = { guestHash: "already-finished" };
    const completed = await beforeCrash.reserve(completedGuest, "already-finished");
    await beforeCrash.finish(completed, true);
    await pool.end();
    pool = new Pool({ connectionString, max: 12, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
    const afterRestart = quotaWithRecovery(pool);
    await afterRestart.recoverExpired();
    assert.equal((await afterRestart.balance(identity)).available, 0, "another instance must not reclaim an unexpired job");
    instant = new Date(instant.getTime() + leaseMs);
    await assert.rejects(afterRestart.finish(abandonedFree, true));
    await assert.rejects(afterRestart.finish(abandonedPaid, true));
    await burst(() => afterRestart.recoverExpired());
    assert.equal((await afterRestart.balance(identity)).available, 2, "return both credits exactly once");
    assert.equal((await afterRestart.balance(completedGuest)).free, 0, "never refund a successful job");
    await assert.rejects(afterRestart.finish(abandonedFree, true));
    await assert.rejects(afterRestart.finish(abandonedPaid, true));
    console.log(`PASS: 100-way bursts, reconnect, free-to-paid transition and Beijing 02:00 reset; ${Math.round(performance.now() - started)} ms`);
  } finally {
    if (pool) await pool.end();
    // This exact random schema was created by this test; no other schema is touched.
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}
main().catch(error => {
  console.error("PostgreSQL acceptance failed.", error instanceof assert.AssertionError ? error : { name: error.name, code: error.code, where: error.stack?.split("\n")[1]?.trim() });
  process.exitCode = 1;
});
