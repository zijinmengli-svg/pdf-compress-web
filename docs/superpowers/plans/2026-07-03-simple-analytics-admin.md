# Simple Analytics Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a password-protected `/admin` dashboard to TinyPDF with local JSONL analytics storage, user-flow tracking, file-name classification, and privacy-copy updates.

**Architecture:** Keep the current native Node server and static frontend. Add a small analytics module for event storage and summary aggregation, wire server/client events into existing flows, and serve a static admin page backed by authenticated `/api/admin/*` endpoints.

**Tech Stack:** Node.js native `http`, `fs`, `crypto`; static HTML/CSS/JavaScript; local JSONL file storage; existing Node test style.

## Global Constraints

- Admin page is `https://tinypdf.cn/admin`.
- Admin APIs are `/api/admin/*`.
- Analytics storage is `data/analytics-events.jsonl`.
- Admin password comes from `ADMIN_PASSWORD`.
- If `ADMIN_PASSWORD` is not configured, admin login is unavailable.
- Do not store PDF file contents or compressed PDF outputs for analytics.
- Do not read PDF page count, PDF dimensions, or PDF text.
- Do record uploaded file names and classify them using filename-only keyword rules.
- Do not add paid analytics vendors, external databases, user accounts, heatmaps, or session replay.
- Preserve existing public tool behavior.

---

### Task 1: Analytics Core

**Files:**
- Create: `lib/analytics.js`
- Test: `test/analytics-admin.test.js`

**Interfaces:**
- Produces:
  - `classifyFileName(fileName: string): string`
  - `appendAnalyticsEvent(filePath: string, event: object): Promise<object>`
  - `readAnalyticsEvents(filePath: string): Promise<object[]>`
  - `summarizeAnalytics(events: object[], now?: Date): object`

- [ ] **Step 1: Write failing tests**

Add tests for file classification, JSONL append/read, and summary aggregation in `test/analytics-admin.test.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/analytics-admin.test.js`

Expected: FAIL because `lib/analytics.js` does not exist.

- [ ] **Step 3: Implement analytics core**

Create `lib/analytics.js` with filename-only classification, safe JSONL append/read, and dashboard summary helpers.

- [ ] **Step 4: Run focused test**

Run: `node test/analytics-admin.test.js`

Expected: PASS.

### Task 2: Server Analytics And Admin APIs

**Files:**
- Modify: `server-simple.js`
- Modify: `test/analytics-admin.test.js`

**Interfaces:**
- Consumes `lib/analytics.js`.
- Produces:
  - POST `/api/track`
  - POST `/api/admin/login`
  - GET `/api/admin/summary`
  - POST `/api/admin/logout`
  - static `/admin` route via existing extensionless static handling.

- [ ] **Step 1: Add failing tests**

Extend `test/analytics-admin.test.js` to verify admin login is unavailable without `ADMIN_PASSWORD`, login works with `ADMIN_PASSWORD`, unauthenticated summary is rejected, and authenticated summary returns metrics.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/analytics-admin.test.js`

Expected: FAIL because admin endpoints do not exist.

- [ ] **Step 3: Implement server behavior**

Add analytics file constants, session cookie helpers, `/api/track` persistence, server-side `page_view`, `pdf_upload`, `compress_success`, `compress_error`, and `download_clicked` event writes, plus admin auth and summary endpoints.

- [ ] **Step 4: Run focused test**

Run: `node test/analytics-admin.test.js`

Expected: PASS.

### Task 3: Client Tracking And Admin UI

**Files:**
- Modify: `public/app-simple.js`
- Create: `public/admin.html`
- Create: `public/admin.js`
- Modify: `public/styles.css`
- Modify: `test/analytics-admin.test.js`

**Interfaces:**
- Consumes POST `/api/track`, POST `/api/admin/login`, GET `/api/admin/summary`, POST `/api/admin/logout`.
- Produces visible admin dashboard sections: overview, acquisition, funnel, behavior, compression, file analytics, recent events.

- [ ] **Step 1: Add static asset tests**

Extend `test/analytics-admin.test.js` to verify `/admin` serves the admin HTML and references `/admin.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/analytics-admin.test.js`

Expected: FAIL because `public/admin.html` and `public/admin.js` do not exist.

- [ ] **Step 3: Implement client/admin UI**

Add client events for `file_selected`, `compress_started`, `download_clicked`, and `session_end`. Build a simple admin login and dashboard UI that renders summary JSON.

- [ ] **Step 4: Run focused test**

Run: `node test/analytics-admin.test.js`

Expected: PASS.

### Task 4: Privacy Copy And Full Verification

**Files:**
- Modify: `public/privacy.html`
- Modify: `package.json`

**Interfaces:**
- Produces privacy disclosure covering file-name analytics without PDF-content storage.

- [ ] **Step 1: Add privacy/test script expectation**

Update tests or package script so `npm test` runs the new analytics admin test.

- [ ] **Step 2: Update privacy copy**

Add clear wording that TinyPDF records uploaded file names, file sizes, target sizes, compression results, and interaction events for product analytics, and does not store PDF contents or compressed outputs for analytics.

- [ ] **Step 3: Run all tests**

Run: `npm test`

Expected: all existing tests plus analytics admin tests pass.

- [ ] **Step 4: Manual local verification**

Start the server with `ADMIN_PASSWORD` set, open `/admin`, log in, trigger one homepage/file-selection flow, and verify the dashboard shows events.
