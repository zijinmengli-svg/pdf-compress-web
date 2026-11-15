"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { newDb } = require("pg-mem");
const { createPrepaidLedger } = require("../lib/payment/prepaid-ledger");

test("a job reserves one credit, failure releases it, success consumes only once", async () => {
  const pool = new (newDb({ noAstCoverageCheck: true }).adapters.createPg().Pool)();
  await pool.query("CREATE TABLE auth_accounts (id uuid PRIMARY KEY)");
  await pool.query(fs.readFileSync(require.resolve("../lib/payment/prepaid-schema.sql"), "utf8"));
  await pool.query(fs.readFileSync(require.resolve("../lib/payment/prepaid-reservations-v1.sql"), "utf8"));
  const ledger = createPrepaidLedger({ pool });
  const walletHash = "reservation-owner";
  await ledger.ensureDailyFreeCredit({ walletHash });
  assert.equal((await ledger.reserveJob({ walletHash, jobId: "job-a" })).reserved, true);
  assert.equal((await ledger.reserveJob({ walletHash, jobId: "job-a" })).duplicate, true);
  assert.equal((await ledger.getBalance({ walletHash })).available, 0);
  assert.equal((await ledger.reserveJob({ walletHash, jobId: "job-b" })).reserved, false);
  assert.equal((await ledger.finishJob({ walletHash: "other", jobId: "job-a", success: false })).changed, false);
  assert.equal((await ledger.finishJob({ walletHash, jobId: "job-a", success: false })).changed, true);
  assert.equal((await ledger.finishJob({ walletHash, jobId: "job-a", success: false })).changed, false);
  assert.equal((await ledger.getBalance({ walletHash })).available, 1);
  assert.equal((await ledger.reserveJob({ walletHash, jobId: "job-c" })).reserved, true);
  await ledger.finishJob({ walletHash, jobId: "job-c", success: true });
  await ledger.finishJob({ walletHash, jobId: "job-c", success: true });
  await ledger.finishJob({ walletHash, jobId: "job-c", success: false });
  assert.equal((await ledger.getBalance({ walletHash })).available, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM reward_ledger_events WHERE event_type='spent'")).rows[0].n, 1);
  await pool.end();
});

test("failed overnight job does not carry expired free credit into the next day", async () => {
  const pool = new (newDb({ noAstCoverageCheck: true }).adapters.createPg().Pool)();
  await pool.query("CREATE TABLE auth_accounts (id uuid PRIMARY KEY)");
  await pool.query(fs.readFileSync(require.resolve("../lib/payment/prepaid-schema.sql"), "utf8"));
  await pool.query(fs.readFileSync(require.resolve("../lib/payment/prepaid-reservations-v1.sql"), "utf8"));
  let instant = new Date("2026-11-11T17:59:59Z");
  const ledger = createPrepaidLedger({ pool, now: () => instant });
  const walletHash = "overnight";
  await ledger.ensureDailyFreeCredit({ walletHash });
  await ledger.reserveJob({ walletHash, jobId: "overnight-job" });
  instant = new Date("2026-11-11T18:00:00Z");
  await ledger.ensureDailyFreeCredit({ walletHash });
  await ledger.finishJob({ walletHash, jobId: "overnight-job", success: false });
  assert.equal((await ledger.getBalance({ walletHash })).available, 1);
  await pool.end();
});
