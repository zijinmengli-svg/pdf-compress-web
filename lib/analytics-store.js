"use strict";

const crypto = require("crypto");
const { Pool } = require("pg");
const { appendAnalyticsEvent, readAnalyticsEvents, normalizeEvent } = require("./analytics");

function eventHash(event) {
  return crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

function createAnalyticsStore({ databaseUrl = "", filePath, explicitFilePath = false, pool = null }) {
  const databaseEnabled = !explicitFilePath && Boolean(pool || String(databaseUrl).trim());
  const ownedPool = databaseEnabled && !pool;
  const db = pool || (databaseEnabled ? new Pool({ connectionString: databaseUrl }) : null);
  let readyPromise = null;

  async function ready() {
    if (!databaseEnabled) return;
    if (!readyPromise) {
      readyPromise = db.query(`CREATE TABLE IF NOT EXISTS analytics_events (
        id bigserial PRIMARY KEY,
        event_hash char(64) NOT NULL UNIQUE,
        event jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        recorded_at timestamptz NOT NULL DEFAULT now()
      )`).then(() => db.query("CREATE INDEX IF NOT EXISTS analytics_events_occurred_idx ON analytics_events(occurred_at DESC)"));
    }
    return readyPromise;
  }

  async function append(event) {
    if (!databaseEnabled) return appendAnalyticsEvent(filePath, event);
    const normalized = normalizeEvent(event || {});
    await ready();
    await db.query(
      "INSERT INTO analytics_events(event_hash, event, occurred_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (event_hash) DO NOTHING",
      [eventHash(normalized), JSON.stringify(normalized), normalized.ts]
    );
    return normalized;
  }

  async function importEvents(events) {
    if (!databaseEnabled) throw new Error("DATABASE_URL is required to import analytics events");
    await ready();
    let inserted = 0;
    for (const event of events || []) {
      const normalized = normalizeEvent(event || {});
      const hash = eventHash(normalized);
      const existing = await db.query("SELECT 1 FROM analytics_events WHERE event_hash = $1 LIMIT 1", [hash]);
      if (existing.rowCount) continue;
      const result = await db.query(
        "INSERT INTO analytics_events(event_hash, event, occurred_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (event_hash) DO NOTHING RETURNING id",
        [hash, JSON.stringify(normalized), normalized.ts]
      );
      if (result.rowCount) inserted++;
    }
    return { inserted, skipped: Math.max(0, (events || []).length - inserted) };
  }

  async function readAll() {
    if (!databaseEnabled) return readAnalyticsEvents(filePath);
    await ready();
    const result = await db.query("SELECT event FROM analytics_events ORDER BY id ASC");
    return result.rows.map((row) => typeof row.event === "string" ? JSON.parse(row.event) : row.event);
  }

  async function close() {
    if (ownedPool) await db.end();
  }

  return { append, importEvents, readAll, ready, close, databaseEnabled };
}

module.exports = { createAnalyticsStore, eventHash };
