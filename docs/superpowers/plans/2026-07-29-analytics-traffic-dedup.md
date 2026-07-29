# TinyPDF Analytics Traffic Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep raw analytics intact while making TinyPDF's admin dashboard report deduplicated, bot-filtered effective traffic and visibly explain excluded visits.

**Architecture:** Add a pure summary-time traffic classifier that returns effective page views plus an audit report, and use that view only for traffic metrics while retaining raw product events and CSV exports. Strengthen future classification with a server HMAC fingerprint and a separately testable browser interaction tracker.

**Tech Stack:** Node.js 18+, CommonJS, built-in `crypto`, built-in `node:assert`, custom Node test harnesses, vanilla browser JavaScript.

## Global Constraints

- Raw JSONL storage and CSV export must continue to include every accepted event.
- Existing traffic fields become effective values; compression, error, and download metrics remain raw.
- Store only a truncated HMAC fingerprint; never write a raw IP address to analytics.
- Canonical visitor priority is `trafficFingerprint`, then `clientId`, then `sessionId`.
- Reload deduplication window is 30 minutes for the same canonical visitor, path, and attribution.
- Fingerprint bursts require at least 4 distinct client IDs within 60 minutes and no human or product activity.
- Legacy bursts require at least 8 distinct client IDs within 90 minutes, blank referrer, no human or product activity, and at least 80% sessions ending after 25–35 seconds or lacking `session_end`.
- Any session with `human_interaction`, `file_selected`, `compress_started`, `compress_success`, or `download_clicked` must be preserved.
- Missing or malformed timestamps stay in raw storage but are not classified into a timed burst.
- Classifier failure must fall back to unfiltered traffic and an empty exclusion report.
- Do not change the dashboard UTC day boundary in this work.

---

### Task 1: Effective traffic classifier and summary contract

**Files:**
- Modify: `test/analytics-admin.test.js`
- Modify: `lib/analytics.js`

**Interfaces:**
- Consumes: normalized analytics event objects already accepted by `summarizeAnalytics(events, now)`.
- Produces: `classifyTraffic(events) -> { effectivePageViews, excludedPageViews, rawPageViews, reasons }`, where `reasons` is an object keyed by `reload_duplicate`, `fingerprint_burst`, and `legacy_burst`.
- Produces: `canonicalVisitorId(event) -> string`.
- Extends `summarizeAnalytics()` with `overview.rawPageViews30d`, `overview.rawUniqueVisitors30d`, and `trafficQuality`.
- Extends each promotion row with `rawVisits` and `filteredVisits`; existing `visits` and `visitors` become effective values.

- [ ] **Step 1: Add a failing regression test for the confirmed 19-session DEV burst**

Add a literal fixture to `test/analytics-admin.test.js` that creates:

```js
const suspiciousDevEvents = Array.from({ length: 19 }, (_, index) => {
  const minute = index * 3;
  const ts = new Date(Date.parse("2026-07-29T05:09:00.000Z") + minute * 60000).toISOString();
  return [
    {
      ts,
      event: "page_view",
      sessionId: `dev-session-${index}`,
      clientId: `dev-client-${index}`,
      path: "/",
      referrer: "",
      country: "US",
      device: "desktop",
      browser: "Chrome",
      utm: {
        source: "devto",
        medium: "article",
        campaign: "performance_optimization",
        content: "devto_performance_2026-07-28",
      },
      data: {},
    },
    ...(index < 13 ? [{
      ts: new Date(Date.parse(ts) + (index % 2 ? 29000 : 28000)).toISOString(),
      event: "session_end",
      sessionId: `dev-session-${index}`,
      clientId: `dev-client-${index}`,
      path: "/api/track",
      referrer: "",
      country: "US",
      device: "desktop",
      browser: "Chrome",
      utm: {
        source: "devto",
        medium: "article",
        campaign: "performance_optimization",
        content: "devto_performance_2026-07-28",
      },
      data: { dwellSeconds: index % 2 ? 29 : 28 },
    }] : []),
  ];
}).flat();
```

Prepend one isolated Italian DEV page view and 41 unrelated legitimate page views distributed across exactly 27 client IDs so the literal expected totals match the exported July data. Assert:

```js
assert.strictEqual(summary.overview.rawPageViews30d, 61);
assert.strictEqual(summary.overview.pageViews30d, 42);
assert.strictEqual(summary.overview.rawUniqueVisitors30d, 47);
assert.strictEqual(summary.overview.uniqueVisitors30d, 28);
assert.strictEqual(summary.trafficQuality.excludedPageViews30d, 19);
assert.strictEqual(summary.trafficQuality.excludedVisitors30d, 19);
assert.strictEqual(summary.trafficQuality.reasons.legacy_burst, 19);

const dev = summary.acquisition.promotions.find(row =>
  row.content === "devto_performance_2026-07-28"
);
assert.deepStrictEqual(
  {
    visits: dev.visits,
    rawVisits: dev.rawVisits,
    filteredVisits: dev.filteredVisits,
    visitors: dev.visitors,
  },
  { visits: 1, rawVisits: 20, filteredVisits: 19, visitors: 1 }
);
```

- [ ] **Step 2: Run the regression test and confirm RED**

Run:

```bash
node test/analytics-admin.test.js
```

Expected: FAIL because `rawPageViews30d`, `trafficQuality`, and promotion audit fields do not exist and page views remain 61.

- [ ] **Step 3: Add failing boundary tests for preservation and reload deduplication**

Add independent tests with hand-derived literal expectations:

```js
assert.strictEqual(
  summarizeAnalytics(legacyBurstWithHumanInteraction, now).overview.pageViews30d,
  8
);
assert.strictEqual(
  summarizeAnalytics(fingerprintBurstWithFileSelected, now).overview.pageViews30d,
  4
);

const reloadSummary = summarizeAnalytics([
  pageView("2026-07-29T05:00:00Z", "a", "one", "fp-a"),
  pageView("2026-07-29T05:10:00Z", "a", "two", "fp-a"),
  pageView("2026-07-29T05:31:00Z", "a", "three", "fp-a"),
], now);
assert.strictEqual(reloadSummary.overview.rawPageViews30d, 3);
assert.strictEqual(reloadSummary.overview.pageViews30d, 2);
assert.strictEqual(reloadSummary.trafficQuality.reasons.reload_duplicate, 1);
```

Also assert that a malformed-timestamp page view is kept in raw output and does not cause a valid neighboring event to be classified as a burst.

- [ ] **Step 4: Run the boundary tests and confirm RED**

Run:

```bash
node test/analytics-admin.test.js
```

Expected: FAIL on the new effective page-view expectations while all pre-existing analytics assertions remain unchanged.

- [ ] **Step 5: Implement the pure classifier**

In `lib/analytics.js`, add:

```js
const PRODUCT_EVENTS = new Set([
  "file_selected",
  "compress_started",
  "compress_success",
  "download_clicked",
]);

function canonicalVisitorId(event) {
  return event.trafficFingerprint || event.clientId || event.sessionId || "";
}

function attributionKey(event) {
  const promotion = promotionKeyFor(event);
  return [
    event.path || "/",
    promotion.source,
    promotion.medium,
    promotion.campaign,
    promotion.content,
  ].join("\u0001");
}
```

Implement `classifyTraffic(events)` in chronological order:

1. Build session engagement and `session_end` duration maps from all events.
2. For fingerprint page views, find 60-minute same-fingerprint/attribution/path windows with at least four distinct client IDs and no engaged session.
3. For legacy page views, find 90-minute same-signature windows using UTM, country, device, browser, and referrer; require at least eight distinct client IDs, blank referrer, no engagement, and an 80% matching duration ratio.
4. Mark burst page views before reload deduplication.
5. Deduplicate remaining page views per canonical visitor, path, and attribution when the previous counted view is less than 30 minutes earlier.
6. Return original event references in `effectivePageViews` and `excludedPageViews`, plus literal reason counts.
7. Wrap the classifier call in `summarizeAnalytics()` with a `try/catch` fallback that treats every raw page view as effective.

- [ ] **Step 6: Route traffic-only metrics through effective events**

In `summarizeAnalytics()`:

- replace traffic page-view subsets in overview, comparisons, daily trends, sources, channels, regions, and funnel with effective page views;
- continue calculating compression, error, download, dwell, file, and recent-event fields from raw events;
- calculate effective unique visitors using `canonicalVisitorId`;
- add raw 30-day page-view and visitor values;
- add:

```js
trafficQuality: {
  excludedPageViews30d,
  excludedVisitors30d,
  reasons,
}
```

Update `summarizePromotions(rawEvents, effectivePageViews)` so product conversions come from raw events while visits and visitors come from effective page views:

```js
{
  source,
  medium,
  campaign,
  content,
  visits,
  rawVisits,
  filteredVisits: rawVisits - visits,
  visitors,
  compressions,
  downloads,
}
```

- [ ] **Step 7: Run analytics tests and confirm GREEN**

Run:

```bash
node test/analytics-admin.test.js
```

Expected: all tests pass, including exact 61→42 page views and 47→28 visitors.

- [ ] **Step 8: Commit the classifier**

```bash
git add lib/analytics.js test/analytics-admin.test.js
git commit -m "fix: filter duplicate analytics traffic"
```

### Task 2: Privacy-preserving server fingerprint

**Files:**
- Create: `lib/traffic-fingerprint.js`
- Create: `test/traffic-fingerprint.test.js`
- Modify: `lib/analytics.js`
- Modify: `server-simple.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: a Node request with `headers` and `socket.remoteAddress`, plus a secret string.
- Produces: `trafficFingerprint(req, secret) -> string`, a 32-character hexadecimal HMAC prefix or `""`.
- Produces: `clientAddress(req) -> string`, used only in memory while hashing.
- `requestMeta()` adds `trafficFingerprint`; `normalizeEvent()` persists it as a string.

- [ ] **Step 1: Write failing unit tests for fingerprint stability and privacy**

Create `test/traffic-fingerprint.test.js`:

```js
"use strict";
const assert = require("assert");
const { trafficFingerprint } = require("../lib/traffic-fingerprint");

const request = {
  headers: {
    "cf-connecting-ip": "203.0.113.10",
    "user-agent": " Mozilla/5.0   Chrome/120 ",
  },
  socket: { remoteAddress: "127.0.0.1" },
};

const first = trafficFingerprint(request, "test-secret");
const second = trafficFingerprint({
  ...request,
  headers: {
    "cf-connecting-ip": "203.0.113.10",
    "user-agent": "mozilla/5.0 chrome/120",
  },
}, "test-secret");

assert.strictEqual(first, second);
assert.match(first, /^[a-f0-9]{32}$/);
assert.ok(!first.includes("203.0.113.10"));
assert.notStrictEqual(
  first,
  trafficFingerprint({ ...request, headers: { ...request.headers, "cf-connecting-ip": "203.0.113.11" } }, "test-secret")
);
assert.notStrictEqual(
  first,
  trafficFingerprint({ ...request, headers: { ...request.headers, "user-agent": "Firefox/130" } }, "test-secret")
);
assert.strictEqual(trafficFingerprint(request, ""), "");
```

- [ ] **Step 2: Run the fingerprint test and confirm RED**

Run:

```bash
node test/traffic-fingerprint.test.js
```

Expected: FAIL with `Cannot find module '../lib/traffic-fingerprint'`.

- [ ] **Step 3: Implement address selection, normalization, and HMAC**

Create `lib/traffic-fingerprint.js`:

```js
"use strict";
const crypto = require("crypto");

function firstHeaderAddress(value) {
  return String(value || "").split(",")[0].trim();
}

function clientAddress(req) {
  return firstHeaderAddress(
    req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    (req.socket && req.socket.remoteAddress) ||
    ""
  );
}

function normalizedUserAgent(req) {
  return String(req.headers["user-agent"] || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function trafficFingerprint(req, secret) {
  const address = clientAddress(req);
  const userAgent = normalizedUserAgent(req);
  if (!secret || !address || !userAgent) return "";
  return crypto.createHmac("sha256", secret)
    .update(`${address}\n${userAgent}`)
    .digest("hex")
    .slice(0, 32);
}

module.exports = { clientAddress, trafficFingerprint };
```

- [ ] **Step 4: Run the fingerprint test and confirm GREEN**

Run:

```bash
node test/traffic-fingerprint.test.js
```

Expected: PASS.

- [ ] **Step 5: Add a failing ingestion integration assertion**

Extend the authenticated `/api/track` integration test in `test/analytics-admin.test.js` to:

- start the server with `ANALYTICS_FINGERPRINT_SECRET: "integration-fingerprint-secret"`;
- send two tracking events with the same `CF-Connecting-IP` and User-Agent;
- read the JSONL file;
- assert both records have the same 32-character fingerprint;
- assert the serialized JSONL does not contain the literal IP.

```js
assert.match(events[0].trafficFingerprint, /^[a-f0-9]{32}$/);
assert.strictEqual(events[0].trafficFingerprint, events[1].trafficFingerprint);
assert.ok(!rawJsonl.includes("203.0.113.40"));
```

- [ ] **Step 6: Run the integration test and confirm RED**

Run:

```bash
node test/analytics-admin.test.js
```

Expected: FAIL because `requestMeta()` and `normalizeEvent()` do not yet carry `trafficFingerprint`.

- [ ] **Step 7: Wire the fingerprint into ingestion**

In `server-simple.js`:

```js
const { trafficFingerprint } = require("./lib/traffic-fingerprint");
const ANALYTICS_FINGERPRINT_SECRET =
  process.env.ANALYTICS_FINGERPRINT_SECRET || WEB_SESSION_SECRET;
```

Add to `requestMeta()`:

```js
trafficFingerprint: trafficFingerprint(req, ANALYTICS_FINGERPRINT_SECRET),
```

In `lib/analytics.js`, add to `normalizeEvent()`:

```js
trafficFingerprint: String(event.trafficFingerprint || ""),
```

Append `node test/traffic-fingerprint.test.js` to the `npm test` script.

- [ ] **Step 8: Run focused tests and confirm GREEN**

Run:

```bash
node test/traffic-fingerprint.test.js
node test/analytics-admin.test.js
```

Expected: both pass, fingerprints are stable, and no raw address is persisted.

- [ ] **Step 9: Commit the ingestion signal**

```bash
git add lib/traffic-fingerprint.js lib/analytics.js server-simple.js test/traffic-fingerprint.test.js test/analytics-admin.test.js package.json
git commit -m "feat: add anonymous analytics fingerprint"
```

### Task 3: One-shot human interaction signal

**Files:**
- Create: `public/human-interaction.js`
- Create: `test/human-interaction.test.js`
- Modify: `public/index.html`
- Modify: `public/app-simple.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `setupHumanInteractionTracking({ windowRef, documentRef, onInteraction, scrollThreshold })`.
- Produces: a cleanup function; calls `onInteraction()` at most once.
- `public/app-simple.js` calls the browser global `window.TinyPDFHumanInteraction.setup(...)` and sends `human_interaction`.

- [ ] **Step 1: Write a failing behavioral test**

Create `test/human-interaction.test.js` with a real fake event target:

```js
"use strict";
const assert = require("assert");
const { setupHumanInteractionTracking } = require("../public/human-interaction");

function eventTarget() {
  const handlers = new Map();
  return {
    addEventListener(name, fn) { handlers.set(name, fn); },
    removeEventListener(name, fn) {
      if (handlers.get(name) === fn) handlers.delete(name);
    },
    fire(name, event = {}) {
      const fn = handlers.get(name);
      if (fn) fn(event);
    },
  };
}

const windowRef = { ...eventTarget(), scrollY: 0 };
const documentRef = eventTarget();
let calls = 0;
const cleanup = setupHumanInteractionTracking({
  windowRef,
  documentRef,
  scrollThreshold: 120,
  onInteraction: () => { calls++; },
});

windowRef.scrollY = 60;
windowRef.fire("scroll");
assert.strictEqual(calls, 0);
documentRef.fire("pointerdown");
documentRef.fire("keydown");
windowRef.scrollY = 500;
windowRef.fire("scroll");
assert.strictEqual(calls, 1);
cleanup();
```

Add a second case where scroll alone exceeds 120 pixels and triggers exactly once.

- [ ] **Step 2: Run the interaction test and confirm RED**

Run:

```bash
node test/human-interaction.test.js
```

Expected: FAIL with `Cannot find module '../public/human-interaction'`.

- [ ] **Step 3: Implement the UMD-compatible tracker**

Create `public/human-interaction.js` with a small factory that:

- subscribes to `pointerdown`, `touchstart`, and `keydown` on `documentRef`;
- subscribes to `scroll` on `windowRef`;
- compares current scroll position with the starting scroll position;
- calls `onInteraction()` once;
- removes all listeners immediately after firing and from the returned cleanup function;
- exports through `module.exports` in Node and `window.TinyPDFHumanInteraction` in the browser.

- [ ] **Step 4: Run the interaction test and confirm GREEN**

Run:

```bash
node test/human-interaction.test.js
```

Expected: both pointer and meaningful-scroll cases pass.

- [ ] **Step 5: Wire the tracker into the homepage**

Load the module before `app-simple.js` in `public/index.html`:

```html
<script src="/human-interaction.js?v=1.0.0" defer></script>
<script src="/app-simple.js?v=1.6.0" defer></script>
```

In `public/app-simple.js`, after `trackEvent()` is defined:

```js
if (window.TinyPDFHumanInteraction) {
  window.TinyPDFHumanInteraction.setupHumanInteractionTracking({
    windowRef: window,
    documentRef: document,
    scrollThreshold: 120,
    onInteraction: () => trackEvent("human_interaction"),
  });
}
```

Append `node test/human-interaction.test.js` to the `npm test` script.

- [ ] **Step 6: Run focused homepage tests**

Run:

```bash
node test/human-interaction.test.js
node test/i18n.test.js
node test/p0-ai-discovery.test.js
```

Expected: all pass and the existing i18n-before-app ordering remains true.

- [ ] **Step 7: Commit the interaction signal**

```bash
git add public/human-interaction.js public/index.html public/app-simple.js test/human-interaction.test.js package.json
git commit -m "feat: record human analytics interaction"
```

### Task 4: Admin audit presentation and production-data verification

**Files:**
- Modify: `public/admin.js`
- Modify: `public/admin.html`
- Modify: `test/analytics-admin.test.js`

**Interfaces:**
- Consumes: Task 1 summary fields `overview.rawPageViews30d`, `overview.rawUniqueVisitors30d`, `trafficQuality`, and promotion `rawVisits`/`filteredVisits`.
- Produces: dashboard footnotes and a promotion table with an explicit “已过滤” column.

- [ ] **Step 1: Add failing admin contract assertions**

In the existing `/admin` integration test, assert the returned HTML includes the new promotion heading and that the summary includes the audit contract:

```js
assert.ok(adminPage.body.includes("<th>已过滤</th>"));
assert.strictEqual(typeof body.overview.rawPageViews30d, "number");
assert.strictEqual(typeof body.overview.rawUniqueVisitors30d, "number");
assert.strictEqual(typeof body.trafficQuality.excludedPageViews30d, "number");
```

Add a promotion fixture with one filtered page view and assert `rawVisits`, `visits`, and `filteredVisits` independently.

- [ ] **Step 2: Run the admin integration test and confirm RED**

Run:

```bash
node test/analytics-admin.test.js
```

Expected: FAIL because the admin table does not yet contain the “已过滤” column.

- [ ] **Step 3: Render raw-versus-effective footnotes**

In `public/admin.js`, calculate:

```js
const excludedViews = Number(summary.trafficQuality && summary.trafficQuality.excludedPageViews30d || 0);
const excludedVisitors = Number(summary.trafficQuality && summary.trafficQuality.excludedVisitors30d || 0);
const pageViewFootnote = `原始 ${formatNumber(summary.overview.rawPageViews30d)}，已过滤 ${formatNumber(excludedViews)} 次异常访问`;
const visitorFootnote = `原始 ${formatNumber(summary.overview.rawUniqueVisitors30d)}，已过滤 ${formatNumber(excludedVisitors)} 个异常访客`;
```

Pass these strings to the page-view and visitor `metricCard()` calls. In `renderPromotions()`, insert `row.filteredVisits` between visitor and compression cells and change the empty row `colspan` from 7 to 8.

In `public/admin.html`, change the promotion table header to:

```html
<thead><tr><th>平台</th><th>文章/内容</th><th>活动</th><th>访问</th><th>访客</th><th>已过滤</th><th>压缩</th><th>下载</th></tr></thead>
```

Bump `admin.js` to `v=1.6.0`.

- [ ] **Step 4: Run the admin integration test and confirm GREEN**

Run:

```bash
node test/analytics-admin.test.js
node test/admin-assets.test.js
node test/admin-navigation.test.js
```

Expected: all pass.

- [ ] **Step 5: Verify against the exported July CSV**

Run a read-only Node script that maps `/Users/libin/Downloads/tinypdf-analytics-1m.csv` rows back to analytics events and calls `summarizeAnalytics(events, new Date("2026-07-29T15:47:13+08:00"))`.

Assert the literal production-data results:

```js
assert.strictEqual(summary.overview.rawPageViews30d, 61);
assert.strictEqual(summary.overview.pageViews30d, 42);
assert.strictEqual(summary.overview.rawUniqueVisitors30d, 47);
assert.strictEqual(summary.overview.uniqueVisitors30d, 28);
assert.strictEqual(summary.trafficQuality.excludedPageViews30d, 19);
```

Also generate `exportAnalyticsCsv(events, "all", now)` and assert its data-row count equals the input event-row count so filtering has not removed export coverage.

- [ ] **Step 6: Run the complete test suite**

Run:

```bash
npm test
```

Expected: every test exits 0.

- [ ] **Step 7: Perform a browser smoke test**

Start the server with a temporary analytics file and admin password, open `/admin`, log in, and verify:

- page-view and visitor cards show effective totals;
- each card includes raw and filtered counts;
- the DEV promotion row includes the filtered count;
- compression and download values remain unchanged;
- the browser console has no new errors.

- [ ] **Step 8: Commit the admin presentation**

```bash
git add public/admin.js public/admin.html test/analytics-admin.test.js
git commit -m "feat: show filtered traffic in analytics admin"
```

- [ ] **Step 9: Final diff and safety review**

Run:

```bash
git status --short
git diff --check
git log --oneline --decorate -5
```

Expected: only planned files are changed, no whitespace errors are reported, and the user's pre-existing untracked files remain outside the isolated worktree.
