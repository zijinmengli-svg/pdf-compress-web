"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { newDb } = require("pg-mem");

function sql(name) { return fs.readFileSync(path.join(__dirname, "../lib/payment", name), "utf8"); }

test("prepaid schema is additive, repeatable, and bound to canonical auth accounts", async () => {
  const db = newDb({ noAstCoverageCheck: true });
  const pool = new (db.adapters.createPg().Pool)();
  await pool.query(fs.readFileSync(path.join(__dirname, "../lib/auth/schema.sql"), "utf8"));
  const accountId = "00000000-0000-4000-8000-000000000001";
  await pool.query("INSERT INTO auth_accounts (id,email,created_at,updated_at) VALUES ($1,$2,now(),now())", [accountId, "owner@example.com"]);
  await pool.query("INSERT INTO auth_sessions (token_hash,account_id,expires_at,created_at) VALUES ($1,$2,now(),now())", ["existing-session", accountId]);
  await pool.query(sql("prepaid-schema.sql"));
  await pool.query(sql("account-wallet-schema.sql"));
  const walletId = "00000000-0000-4000-8000-000000000002";
  await pool.query("INSERT INTO reward_wallets (id,wallet_hash) VALUES ($1,$2)", [walletId, "account-wallet"]);
  await pool.query("INSERT INTO account_wallets (account_id,wallet_hash) VALUES ($1,$2)", [accountId, "account-wallet"]);
  await pool.query("INSERT INTO credit_purchases (transaction_id,wallet_hash,account_id,paddle_price_id,paddle_product_id,quantity,customer_amount_minor,customer_currency) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", ["txn_test_1", "account-wallet", accountId, "pri_test", "pro_test", 3, 2970, "CNY"]);
  await pool.query(sql("prepaid-schema.sql"));
  await pool.query(sql("account-wallet-schema.sql"));
  assert.equal((await pool.query("SELECT account_id FROM auth_sessions WHERE token_hash = $1", ["existing-session"])).rows[0].account_id, accountId);
  assert.equal((await pool.query("SELECT wallet_hash FROM account_wallets WHERE account_id = $1", [accountId])).rows[0].wallet_hash, "account-wallet");
  assert.equal((await pool.query("SELECT quantity FROM credit_purchases WHERE transaction_id = $1", ["txn_test_1"])).rows[0].quantity, 3);
  await assert.rejects(pool.query("INSERT INTO credit_purchases (transaction_id,wallet_hash,account_id,paddle_price_id,paddle_product_id,quantity,customer_amount_minor,customer_currency) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", ["txn_test_2", "account-wallet", "00000000-0000-4000-8000-000000000099", "pri_test", "pro_test", 1, 990, "CNY"]));
  await pool.end();
});
