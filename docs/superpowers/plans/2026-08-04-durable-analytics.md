# Durable Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve TinyPDF analytics through Render restarts and restore the locally backed-up historical events to Neon.

**Architecture:** Retain JSONL for local development and explicit `ANALYTICS_FILE` overrides. In deployed environments with `DATABASE_URL` and no explicit file override, use a small analytics event table in Neon. The admin summary continues to call the existing pure `summarizeAnalytics` function over the store's events.

**Tech Stack:** Node.js 20, `pg`, Neon PostgreSQL, existing TinyPDF admin API.

## Global Constraints

- Do not store PDF content, payment secrets, or session capabilities in analytics.
- Preserve the existing JSONL store for tests and local development.
- Event writes must not break PDF compression when the analytics store is unavailable.
- Do not import duplicate historical events on a retry.

---

### Task 1: Durable analytics store

**Files:**
- Create: `lib/analytics-store.js`
- Create: `db/migrations/002_analytics_events.sql`
- Modify: `server-simple.js`
- Test: `test/analytics-store.test.js`

**Interfaces:**
- Produces `createAnalyticsStore({ databaseUrl, filePath, explicitFilePath })` with `ready()`, `append(event)`, `readAll()`, and `close()`.
- Uses `normalizeEvent(event)` from `lib/analytics.js`.

- [ ] **Step 1: Write the failing test**

```js
const store = await createAnalyticsStore({ databaseUrl: pgMemUrl, filePath: tempFile, explicitFilePath: false });
await store.append({ event: "page_view", clientId: "visitor-1", data: {} });
assert.strictEqual((await store.readAll()).length, 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/analytics-store.test.js`

Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
async function append(event) {
  const normalized = normalizeEvent(event);
  await pool.query("INSERT INTO analytics_events(event) VALUES ($1::jsonb)", [JSON.stringify(normalized)]);
  return normalized;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/analytics-store.test.js`

Expected: PASS.

### Task 2: Correct dashboard data source and empty-funnel display

**Files:**
- Modify: `server-simple.js`
- Modify: `public/admin.js`
- Test: `test/analytics-admin.test.js`

**Interfaces:**
- `/api/admin/summary` and `/api/admin/export` obtain events with `analyticsStore.readAll()`.
- `handleStatic` records a durable `page_view` for each accepted browser navigation.

- [ ] **Step 1: Write the failing test**

```js
assert.strictEqual(downloadRate({ funnel: { page_view: 0, download_clicked: 1 } }), 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/analytics-admin.test.js`

Expected: FAIL if the UI helper yields a non-zero conversion without visits.

- [ ] **Step 3: Write minimal implementation**

```js
if (pageViewCid) recordAnalytics(req, url, "page_view", { pageTitle: "TinyPDF" }, { clientId: pageViewCid });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/analytics-admin.test.js`

Expected: PASS.

### Task 3: Restore historical data and release

**Files:**
- Create: `scripts/import-analytics-jsonl.js`
- Modify: `package.json`

**Interfaces:**
- `node scripts/import-analytics-jsonl.js /safe/path/analytics-events.jsonl` imports JSONL idempotently using `DATABASE_URL`.

- [ ] **Step 1: Add import test and run it red**

```js
assert.strictEqual(result.inserted, 52);
assert.strictEqual(retry.inserted, 0);
```

- [ ] **Step 2: Implement import and run green**

Run: `npm test`

Expected: all existing tests plus storage/import tests pass.

- [ ] **Step 3: Deploy and verify online**

Run: health request, one browser-style visit, one compression, and admin-summary verification.

Expected: a restart does not reset durable events; the dashboard has a non-zero visit before compression funnel values are calculated.
