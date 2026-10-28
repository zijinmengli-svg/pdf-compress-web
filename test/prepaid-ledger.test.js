"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { newDb } = require("pg-mem");
const { createPrepaidLedger } = require("../lib/payment/prepaid-ledger");

async function setup() {
  const db = newDb({ noAstCoverageCheck: true });
  const pool = new (db.adapters.createPg().Pool)();
  const schema = fs.readFileSync(path.join(__dirname, "../lib/payment/prepaid-schema.sql"), "utf8");
  // This ledger test needs only the wallet/ledger tables, not the external auth service.
  await pool.query("CREATE TABLE auth_accounts (id uuid PRIMARY KEY, email text NOT NULL UNIQUE)");
  await pool.query(schema);
  const ledger = createPrepaidLedger({ pool });
  return { pool, ledger };
}

test("paid credits are spent only by an explicit successful-job settlement, once per job", async () => {
  const { pool, ledger } = await setup();
  const wallet = await ledger.ensureWallet({ walletHash: "account-a" });
  await ledger.grantPurchasedCredit({ walletId: wallet.id, transactionId: "txn_paid_a", quantity: 3, expiresAt: new Date("9999-12-31") });
  assert.equal((await ledger.getBalance({ walletHash: "account-a" })).available, 3);
  assert.equal((await ledger.getBalance({ walletHash: "account-b" })).available, 0);
  assert.deepEqual(await ledger.consumeSuccessfulJob({ walletHash: "account-a", jobId: "job_success_1" }), { spent: true, duplicate: false, remaining: 2 });
  assert.deepEqual(await ledger.consumeSuccessfulJob({ walletHash: "account-a", jobId: "job_success_1" }), { spent: true, duplicate: true, remaining: 2 });
  assert.equal((await ledger.getBalance({ walletHash: "account-a" })).available, 2);
  await pool.end();
});

test("different account cannot spend the first account's purchased credits", async () => {
  const { pool, ledger } = await setup();
  const a = await ledger.ensureWallet({ walletHash: "account-a" });
  await ledger.ensureWallet({ walletHash: "account-b" });
  await ledger.grantPurchasedCredit({ walletId: a.id, transactionId: "txn_paid_a", quantity: 1, expiresAt: new Date("9999-12-31") });
  assert.deepEqual(await ledger.consumeSuccessfulJob({ walletHash: "account-b", jobId: "job_success_2" }), { spent: false, duplicate: false, remaining: 0 });
  assert.equal((await ledger.getBalance({ walletHash: "account-a" })).available, 1);
  await pool.end();
});
