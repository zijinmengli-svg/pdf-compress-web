"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { newDb } = require("pg-mem");
const { createPrepaidLedger } = require("../lib/payment/prepaid-ledger");
const { createTinyPdfAdapter } = require("../lib/payment/tinypdf-adapter");

const FIRST = "00000000-0000-4000-8000-000000000001";
const SECOND = "00000000-0000-4000-8000-000000000002";
const schema = name => fs.readFileSync(path.join(__dirname, "../lib/payment", name), "utf8");

async function setup() {
  const db = newDb({ noAstCoverageCheck: true });
  const pool = new (db.adapters.createPg().Pool)();
  await pool.query(fs.readFileSync(path.join(__dirname, "../lib/auth/schema.sql"), "utf8"));
  await pool.query(schema("prepaid-schema.sql"));
  await pool.query(schema("account-wallet-schema.sql"));
  await pool.query("INSERT INTO auth_accounts(id,email,created_at,updated_at) VALUES ($1,$2,now(),now()),($3,$4,now(),now())", [FIRST, "one@example.com", SECOND, "two@example.com"]);
  const authService = { async getSession(token) {
    const id = token === "first-device" || token === "second-device" ? FIRST : token === "other-account" ? SECOND : null;
    return id ? { account: { id } } : null;
  } };
  const ledger = createPrepaidLedger({ pool });
  const adapter = createTinyPdfAdapter({ pool, authService, ledger, identityHashSecret: "wallet-secret" });
  return { pool, adapter, ledger };
}

test("TinyPDF payment subject requires a verified account and is stable across devices", async () => {
  const { pool, adapter } = await setup();
  await assert.rejects(adapter.resolveSubject("forged", "guest"), /session/i);
  const a = await adapter.resolveSubject("first-device", "guest");
  const again = await adapter.resolveSubject("second-device", "guest");
  const b = await adapter.resolveSubject("other-account", "guest");
  assert.deepEqual(a, again);
  assert.equal(a.namespace, "tinypdf");
  assert.equal(a.id, FIRST);
  assert.notEqual(a.walletHash, b.walletHash);
  await pool.end();
});

test("each paid order is granted once and refunds depend on that order's unused bundle", async () => {
  const { pool, adapter, ledger } = await setup();
  const subject = await adapter.resolveSubject("first-device", "guest");
  const first = { orderId: "ord_one", transactionId: "txn_one", subject, units: 1 };
  const second = { orderId: "ord_two", transactionId: "txn_two", subject, units: 3 };
  assert.equal((await adapter.grant(first)).granted, true);
  assert.equal((await adapter.grant(first)).granted, false);
  assert.equal((await adapter.grant(second)).granted, true);
  assert.equal((await ledger.getBalance({ walletHash: subject.walletHash })).available, 4);
  await ledger.consumeSuccessfulJob({ walletHash: subject.walletHash, jobId: "job_one" });
  assert.equal((await adapter.refundEligibility(first)).eligible, false);
  assert.equal((await adapter.refundEligibility(second)).eligible, true);
  const spent = (await pool.query("SELECT l.source_key FROM reward_ledger_events e JOIN reward_ledger l ON l.id=e.ledger_id WHERE e.job_id='job_one'")).rows[0];
  assert.equal(spent.source_key, "purchase:txn_one");
  await pool.end();
});

test("unused bundle can be frozen and restored without spending another order's credit", async () => {
  const { pool, adapter, ledger } = await setup();
  const subject = await adapter.resolveSubject("first-device", "guest");
  const order = { orderId: "ord_three", transactionId: "txn_three", subject, units: 3 };
  await adapter.grant(order);
  assert.equal((await adapter.freezeUnused(order)).frozen, true);
  assert.equal((await ledger.getBalance({ walletHash: subject.walletHash })).available, 0);
  assert.equal((await adapter.restoreFrozen(order)).restored, true);
  assert.equal((await ledger.getBalance({ walletHash: subject.walletHash })).available, 3);
  assert.equal((await adapter.restoreFrozen(order)).restored, false);
  await pool.end();
});

test("approved refund permanently revokes only its previously frozen bundle", async () => {
  const { pool, adapter, ledger } = await setup();
  const subject = await adapter.resolveSubject("first-device", "guest");
  const order = { orderId: "ord_refund", transactionId: "txn_refund", subject, units: 3 };
  await adapter.grant(order);
  await adapter.freezeUnused(order);
  assert.equal((await adapter.revokeFrozen(order)).revoked, true);
  assert.equal((await adapter.restoreFrozen(order)).restored, false);
  assert.equal((await ledger.getBalance({ walletHash: subject.walletHash })).available, 0);
  await pool.end();
});

test("existing prepaid ledger schema can migrate to reversible refund freezes", async () => {
  const db = newDb({ noAstCoverageCheck: true });
  const pool = new (db.adapters.createPg().Pool)();
  await pool.query(fs.readFileSync(path.join(__dirname, "../lib/auth/schema.sql"), "utf8"));
  const previousSchema = schema("prepaid-schema.sql")
    .replace("'expired', 'frozen', 'revoked'", "'expired', 'revoked'")
    .replace("'expired', 'frozen', 'restored', 'revoked'", "'expired', 'revoked'")
    .replace("status text NOT NULL CHECK (status IN ('active', 'consumed', 'expired', 'revoked'))",
      "status text NOT NULL CONSTRAINT reward_ledger_status_check CHECK (status IN ('active', 'consumed', 'expired', 'revoked'))")
    .replace("event_type text NOT NULL CHECK (event_type IN ('granted', 'spent', 'expired', 'revoked'))",
      "event_type text NOT NULL CONSTRAINT reward_ledger_events_event_type_check CHECK (event_type IN ('granted', 'spent', 'expired', 'revoked'))");
  await pool.query(previousSchema);
  await pool.query(schema("prepaid-ledger-freeze-v1.sql"));
  await pool.query("INSERT INTO reward_wallets(id,wallet_hash) VALUES ($1,'wallet')", [FIRST]);
  await pool.query("INSERT INTO reward_ledger(id,wallet_id,grant_type,amount,remaining_amount,expires_at,source_key,status) VALUES ($1,$2,'purchase',1,1,now(),'purchase:txn_old','frozen')", [SECOND, FIRST]);
  assert.equal((await pool.query("SELECT status FROM reward_ledger WHERE source_key='purchase:txn_old'")).rows[0].status, "frozen");
  await pool.end();
});

test("an external partial refund holds the remaining credits without touching other bundles", async () => {
  const { pool, adapter, ledger } = await setup();
  const subject = await adapter.resolveSubject("first-device", "guest");
  const first = { orderId: "ord_partial", transactionId: "txn_partial", subject, units: 3 };
  const other = { orderId: "ord_other", transactionId: "txn_other", subject, units: 1 };
  await adapter.grant(first);
  await adapter.grant(other);
  await ledger.consumeSuccessfulJob({ walletHash: subject.walletHash, jobId: "job_partial" });
  assert.equal((await adapter.holdRemaining(first)).frozen, true);
  assert.equal((await ledger.getBalance({ walletHash: subject.walletHash })).available, 1);
  assert.equal((await adapter.refundEligibility(other)).eligible, true);
  await pool.end();
});
