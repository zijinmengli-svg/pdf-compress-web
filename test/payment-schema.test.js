"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { newDb } = require("pg-mem");

test("payment orders survive repeat migrations and transaction IDs are isolated by provider and environment", async () => {
  const db = newDb({ noAstCoverageCheck: true });
  const pool = new (db.adapters.createPg().Pool)();
  await pool.query(fs.readFileSync(path.join(__dirname, "../lib/auth/schema.sql"), "utf8"));
  const schema = fs.readFileSync(path.join(__dirname, "../lib/payment/payment-schema.sql"), "utf8");
  await pool.query(schema);
  const insert = (id, environment, transactionId) => pool.query(`INSERT INTO payment_orders
    (order_id,product_key,offer_key,subject_namespace,subject_id,provider,environment,price_id,product_id,requested_quantity,entitlement_units,status,transaction_id)
    VALUES ($1,'tinypdf','compression-credit','tinypdf','account-1','paddle',$2,'pri_test','pro_test',1,1,'pending',$3)`, [id, environment, transactionId]);
  await insert("ord_1", "sandbox", "txn_same");
  await pool.query(schema);
  assert.equal((await pool.query("SELECT product_key FROM payment_orders WHERE order_id = 'ord_1'")).rows[0].product_key, "tinypdf");
  await insert("ord_2", "production", "txn_same");
  await assert.rejects(insert("ord_3", "sandbox", "txn_same"));
  await pool.end();
});
