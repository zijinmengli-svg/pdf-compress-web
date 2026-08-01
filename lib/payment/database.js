"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const MIGRATION_LOCK_ID = "7469506466";

function createPaymentPool(connectionString) {
  if (!String(connectionString || "").trim()) throw new TypeError("database connection string is required");
  return new Pool({ connectionString });
}

async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function runPaymentMigrations(pool, migrationsDir) {
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query("CREATE TABLE IF NOT EXISTS payment_schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = await client.query("SELECT version FROM payment_schema_migrations");
    const known = new Set(applied.rows.map((row) => row.version));
    for (const file of files) {
      if (known.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO payment_schema_migrations(version) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try { await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]); } catch {}
    client.release();
  }
}

module.exports = { MIGRATION_LOCK_ID, createPaymentPool, withTransaction, runPaymentMigrations };
