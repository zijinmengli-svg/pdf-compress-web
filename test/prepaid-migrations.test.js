"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { runPrepaidMigrations } = require("../lib/payment/database");

test("prepaid migrations run once under an advisory lock and never touch legacy payment tables", async () => {
  const statements = [];
  const applied = new Set();
  const client = { query: async (sql, params = []) => {
    statements.push(sql);
    if (sql === "SELECT version FROM payment_schema_migrations") return { rows: [...applied].map(version => ({ version })) };
    if (sql.startsWith("INSERT INTO payment_schema_migrations")) { applied.add(params[0]); return { rows: [] }; }
    return { rows: [] };
  }, release() { statements.push("release"); } };
  const pool = { connect: async () => client };
  await runPrepaidMigrations(pool);
  await runPrepaidMigrations(pool);
  assert.deepEqual([...applied], ["prepaid-schema-v1", "prepaid-account-wallet-v1", "payment-orders-v1"]);
  assert.equal(statements.filter(sql => sql.includes("CREATE TABLE IF NOT EXISTS account_wallets")).length, 1);
  assert.equal(statements.filter(sql => sql.includes("CREATE TABLE IF NOT EXISTS credit_purchases")).length, 1);
  assert.equal(statements.filter(sql => sql.includes("CREATE TABLE IF NOT EXISTS payment_orders")).length, 1);
  assert.equal(statements.filter(sql => sql.startsWith("SELECT pg_advisory_lock")).length, 2);
  assert.equal(statements.filter(sql => sql.startsWith("SELECT pg_advisory_unlock")).length, 2);
});
