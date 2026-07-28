# TinyPDF Default English and Link-Only AI Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make English the default TinyPDF experience, move Chinese to `/zh/`, prevent unsupported direct compression calls without a real website session, exclude crawlers from product analytics, and preserve exact landing attribution including `libindesign.cn`.

**Architecture:** Keep the native Node HTTP server and static application. Add a focused `lib/web-session.js` module for signed browser-session, request-token, same-origin, automation, and job-access checks; keep route/content changes in the existing static files and server router. Store a sanitized landing referrer and UTM values inside the signed session so analytics attribution is stateless and survives compression and download events.

**Tech Stack:** Node.js 18+, native `http`, `crypto`, static HTML/CSS/JavaScript, Node `assert` integration tests.

## Global Constraints

- `/` and `/faq` are English; `/zh/` and `/zh/faq` are Chinese.
- `/en`, `/en/`, and `/en/faq` permanently redirect to the equivalent default-English URL.
- AI platforms may crawl public content and recommend links only.
- Do not expose a public compression API, OpenAPI action, MCP tool, or machine invocation example.
- Compression creation, progress, and download require a valid website session and matching job access.
- Identified crawlers must not create product analytics events or client IDs.
- Only a real referrer hostname equal to `libindesign.cn` or ending in `.libindesign.cn` may receive `owned_referral` attribution.
- Missing, manually typed, bookmarked, and unknown sources remain `Direct`.
- Desktop is the maintained workflow; mobile receives basic responsive layout only.
- Preserve the existing compression algorithm, upload limits, ads, admin login, analytics export, and file-deletion behavior.

---

### Task 1: Default-English routes and link-only discovery content

**Files:**
- Modify: `test/p0-ai-discovery.test.js`
- Modify: `server-simple.js`
- Modify: `public/index.html`
- Modify: `public/faq.html`
- Create: `public/zh/index.html`
- Create: `public/zh/faq.html`
- Modify: `public/robots.txt`
- Modify: `public/sitemap.xml`
- Create: `public/llms.txt`

**Interfaces:**
- Produces: English `/` and `/faq`, Chinese `/zh/` and `/zh/faq`, and 301 redirects from legacy English routes.
- Consumes: existing `handleStatic(req, res, url)` and shared page assets.

- [ ] **Step 1: Rewrite the route/content test to express the new contract**

Add assertions equivalent to:

```js
const root = await get("/");
assert.match(root.body, /<html lang="en">/);
assert.match(root.body, /href="\/zh\/"/);
assert.match(root.body, /does not provide a public compression API/i);

const zh = await get("/zh/");
assert.match(zh.body, /<html lang="zh-CN">/);
assert.match(zh.body, /href="\/"/);
assert.match(zh.body, /不提供公共压缩 API/);

const legacy = await get("/en/");
assert.strictEqual(legacy.status, 301);
assert.strictEqual(legacy.headers.location, "/");
```

Assert `/faq` is English, `/zh/faq` is Chinese, all canonical and `hreflang` links match the approved routes, sitemap contains `/zh/`, and `llms.txt` contains official URLs plus the link-only/no-public-API statement without `/api/jobs`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node test/p0-ai-discovery.test.js
```

Expected: failures because `/` is Chinese, `/zh/` is absent, legacy `/en/` does not redirect, and `llms.txt` is absent.

- [ ] **Step 3: Implement routes and crawlable content**

In `handleStatic`, send permanent redirects before static resolution:

```js
const legacyRedirects = new Map([
  ["/en", "/"],
  ["/en/", "/"],
  ["/en/faq", "/faq"],
]);
if (legacyRedirects.has(url.pathname)) {
  res.writeHead(301, { Location: legacyRedirects.get(url.pathname) });
  res.end();
  return;
}
```

Map `/zh` and `/zh/` to `/zh/index.html`. Move the current English documents to the root English routes and current Chinese documents to `/zh/`. Update titles, canonical URLs, alternates, language links, FAQ links, and the visible no-public-API/link-only explanation.

Add `llms.txt` with public product facts and official links only. Update every allowed crawler group and the wildcard group with:

```text
Disallow: /api/
Disallow: /admin
```

Keep `GPTBot` and `ClaudeBot` fully disallowed. Update the sitemap to include `/`, `/faq`, `/zh/`, and `/zh/faq` and remove `/en/` URLs.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node test/p0-ai-discovery.test.js
```

Expected: all language, redirect, metadata, robots, sitemap, and `llms.txt` checks pass.

- [ ] **Step 5: Commit the route/content slice**

```bash
git add test/p0-ai-discovery.test.js server-simple.js public/index.html public/faq.html public/zh/index.html public/zh/faq.html public/robots.txt public/sitemap.xml public/llms.txt
git commit -m "feat: make English the default discovery route"
```

### Task 2: Signed website-session and exact attribution primitives

**Files:**
- Create: `lib/web-session.js`
- Create: `test/web-session.test.js`
- Modify: `lib/analytics.js`
- Modify: `test/analytics-admin.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `createWebSession(secret, landing, now)` → `{ value, claims }`
  - `verifyWebSession(value, secret, now)` → claims or `null`
  - `requestTokenFor(value, secret)` → HMAC string
  - `verifyRequestToken(value, token, secret)` → boolean
  - `isAutomatedUserAgent(userAgent)` → boolean
  - `isSameOriginRequest(req)` → boolean
  - `createJobAccess(sessionClaims)` → `{ ownerSessionId, accessToken }`
  - `verifyJobAccess(job, sessionClaims, accessToken)` → boolean
  - `normalizeLandingAttribution(referrer, utm)` → `{ referrer, utm, source, sourceCategory }`
- Consumes: Node `crypto`, `URL`, and the existing UTM field shape.

- [ ] **Step 1: Write failing unit tests**

Cover:

```js
const owned = normalizeLandingAttribution("https://www.libindesign.cn/projects/tinypdf", {});
assert.strictEqual(owned.source, "libindesign.cn");
assert.strictEqual(owned.sourceCategory, "owned_referral");

assert.strictEqual(normalizeLandingAttribution("", {}).source, "Direct");
assert.strictEqual(normalizeLandingAttribution("not a url", {}).source, "Direct");
assert.notStrictEqual(
  normalizeLandingAttribution("https://libindesign.cn.evil.example/", {}).source,
  "libindesign.cn"
);

const created = createWebSession("test-secret", owned, new Date("2026-07-28T00:00:00Z"));
assert.ok(verifyWebSession(created.value, "test-secret", new Date("2026-07-28T01:00:00Z")));
assert.strictEqual(verifyWebSession(created.value, "wrong-secret", new Date("2026-07-28T01:00:00Z")), null);
assert.strictEqual(verifyWebSession(created.value, "test-secret", new Date("2026-07-28T03:00:00Z")), null);
assert.ok(verifyRequestToken(created.value, requestTokenFor(created.value, "test-secret"), "test-secret"));
```

Also test known crawler user agents, ordinary Chrome, same-origin headers, and job access failing for a different session or token.

Extend analytics tests so `sourceFor` returns only exact owned-site matches as `libindesign.cn`, while empty/invalid sources remain `Direct`. Add `sourceCategoryFor` coverage.

- [ ] **Step 2: Run unit tests and verify RED**

Run:

```bash
node test/web-session.test.js
node test/analytics-admin.test.js
```

Expected: `lib/web-session.js` is missing and analytics does not expose source categories.

- [ ] **Step 3: Implement the pure session and attribution module**

Use base64url JSON claims plus SHA-256 HMAC:

```js
const claims = {
  sid: crypto.randomUUID(),
  iat: now.getTime(),
  exp: now.getTime() + 2 * 60 * 60 * 1000,
  attribution: normalizeLandingAttribution(landing.referrer, landing.utm),
};
const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
const signature = hmac(secret, payload);
const value = `${payload}.${signature}`;
```

Verify signatures with `crypto.timingSafeEqual`. Sanitize referrers to protocol, hostname, port, and pathname only; limit stored values to bounded lengths. UTM fields use the existing five-field shape and bounded strings.

`isAutomatedUserAgent` includes AI search/user agents, bots, crawlers, command-line clients, monitoring clients, and headless tooling. `isSameOriginRequest` requires `Sec-Fetch-Site: same-origin` plus an `Origin` or `Referer` whose host equals the current request host.

Job access stores a random token and the signed session `sid`; verify both with constant-time comparison.

- [ ] **Step 4: Add exact source categories to analytics**

Export `sourceFor` and `sourceCategoryFor`. Apply the exact host rule:

```js
function isLibinDesignHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return host === "libindesign.cn" || host.endsWith(".libindesign.cn");
}
```

Return `owned_referral` only for that exact/suffix match. Keep no-referrer traffic as `Direct`. Add acquisition channel counts without removing the existing source report.

- [ ] **Step 5: Run unit tests and verify GREEN**

Run:

```bash
node test/web-session.test.js
node test/analytics-admin.test.js
```

Expected: session, automation, origin, ownership, exact attribution, and existing analytics tests pass.

- [ ] **Step 6: Add the new unit test to the normal test gate and commit**

Run `test/web-session.test.js` before integration tests in `package.json`, then:

```bash
git add lib/web-session.js lib/analytics.js test/web-session.test.js test/analytics-admin.test.js package.json
git commit -m "feat: add signed website sessions and exact attribution"
```

### Task 3: Enforce link-only access and filter crawler analytics

**Files:**
- Create: `test/web-access-guard.test.js`
- Modify: `server-simple.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: all exports from `lib/web-session.js`.
- Produces: signed cookie `tinypdf_web_session`, `webRequestToken` in `/api/config`, and guarded `/api/jobs` resources.

- [ ] **Step 1: Write the failing server integration tests**

Start the server with fixed `WEB_SESSION_SECRET`, temporary `ANALYTICS_FILE`, and a mock GA endpoint. Assert:

```js
const direct = await request("POST", "/api/jobs", "", {
  "Content-Type": "multipart/form-data; boundary=x"
});
assert.strictEqual(direct.status, 403);
assert.strictEqual(JSON.parse(direct.body).code, "WEBSITE_SESSION_REQUIRED");

const crawlerPage = await request("GET", "/", null, crawlerNavigationHeaders);
assert.strictEqual(crawlerPage.status, 200);
assert.doesNotMatch(String(crawlerPage.headers["set-cookie"] || ""), /tinypdf_web_session/);

const crawlerTrack = await request("POST", "/api/track", JSON.stringify({ event: "page_view" }), crawlerHeaders);
assert.strictEqual(crawlerTrack.status, 204);
```

For a real navigation, capture the session cookie, call `/api/config`, and assert a non-empty `webRequestToken`. Send a same-origin `/api/jobs` request with the cookie and token but an intentionally invalid multipart body; assert it reaches existing validation and returns `400`, not the session `403`.

Unit/integration coverage must also prove that another session cannot access job events or downloads, using a lightweight injected finished job or the pure `verifyJobAccess` function if full compression would require Ghostscript.

- [ ] **Step 2: Run the integration test and verify RED**

Run:

```bash
node test/web-access-guard.test.js
```

Expected: direct job creation is not rejected by session policy, real navigation does not receive a web-session cookie/token, and crawler tracking is persisted.

- [ ] **Step 3: Issue website sessions only to real homepage navigations**

Add `WEB_SESSION_SECRET`, cookie helpers that append rather than overwrite existing `Set-Cookie`, and issue a new signed session on real browser navigation to `/index.html` or `/zh/index.html`. Landing data comes from the actual request:

```js
{
  referrer: req.headers.referer || "",
  utm: utmFromUrl(`https://${req.headers.host}${req.url}`)
}
```

Crawler page loads remain readable but receive neither `tinypdf_web_session` nor `tinypdf_cid`.

- [ ] **Step 4: Return a bound request token from config**

Keep `/api/config` publicly readable for health checks. Include `webRequestToken` only when the request has a valid signed session:

```js
webRequestToken: sessionValue ? requestTokenFor(sessionValue, WEB_SESSION_SECRET) : ""
```

- [ ] **Step 5: Guard tracking, compression, events, and downloads**

Before reading a tracking payload, return `204` for automated user agents or invalid website sessions. For accepted events, override client-supplied referrer and UTM with signed-session attribution.

Before parsing an upload, require:

```js
validSession &&
verifyRequestToken(sessionCookie, req.headers["x-tinypdf-web-token"], WEB_SESSION_SECRET) &&
isSameOriginRequest(req) &&
!isAutomatedUserAgent(req.headers["user-agent"])
```

Bind `ownerSessionId` and a random `accessToken` to each job. Return the access token with the job response. Require the current valid session, same-origin request, and `access` query value for events and downloads.

Add `X-Robots-Tag: noindex, nofollow, noarchive` to JSON, SSE, and PDF API responses.

- [ ] **Step 6: Preserve signed landing attribution in server events**

Build `analyticsMeta` from the verified session claims. Client-supplied UTM/referrer fields may be used only when they match or supplement the signed landing data; they must never turn a Direct session into `libindesign.cn`.

Copy that metadata into `file_selected`, `compress_started`, `compress_success`, `compress_error`, and `download_clicked`.

- [ ] **Step 7: Run integration and existing server tests**

Run:

```bash
node test/web-access-guard.test.js
node test/pageview-filter.test.js
node test/analytics-admin.test.js
```

Expected: all guard, crawler-filter, attribution, page-view, and admin analytics tests pass.

- [ ] **Step 8: Add the integration test to `npm test` and commit**

```bash
git add test/web-access-guard.test.js server-simple.js package.json
git commit -m "feat: require website sessions for PDF jobs"
```

### Task 4: Use request and job tokens in the browser client

**Files:**
- Modify: `public/app-simple.js`
- Modify: `public/i18n.js`
- Modify: `test/i18n.test.js`
- Modify: `test/p0-ai-discovery.test.js`

**Interfaces:**
- Consumes: `/api/config.webRequestToken`, `/api/jobs.accessToken`, guarded events and download URLs.
- Produces: browser requests that satisfy the server guard without extra user steps.

- [ ] **Step 1: Add failing client-contract and localization tests**

Assert that the client:

```js
assert.match(app, /X-TinyPDF-Web-Token/);
assert.match(app, /webRequestToken/);
assert.match(app, /access=/);
assert.strictEqual(en.text("websiteSessionRequired"), "Please refresh TinyPDF and try again.");
assert.strictEqual(zh.text("websiteSessionRequired"), "请刷新 TinyPDF 页面后重试。");
```

Assert both homepage documents load the same client and contain the link-only visible statement.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node test/i18n.test.js
node test/p0-ai-discovery.test.js
```

Expected: request-token, job-access, and localized session-expiry contracts are missing.

- [ ] **Step 3: Integrate the web request token**

Store `webRequestToken` from `/api/config`. Keep the config promise and await it before submission:

```js
let WEB_REQUEST_TOKEN = "";
const configReady = initConfig();

async function doCompress() {
  await configReady;
  // existing validation and upload
}
```

Send `X-TinyPDF-Web-Token` on `/api/jobs`. If the response code is `WEBSITE_SESSION_REQUIRED`, display `websiteSessionRequired`.

- [ ] **Step 4: Integrate job access**

Store the returned access token. Add it with `encodeURIComponent` to EventSource and download URLs:

```js
activeEvents = new EventSource(`/api/jobs/${payload.id}/events?access=${encodeURIComponent(payload.accessToken)}`);
link.href = `/api/jobs/${activeJobId}/download?access=${encodeURIComponent(activeJobAccessToken)}`;
```

Clear job identifiers and access tokens together when a new job starts or expires.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
node test/i18n.test.js
node test/p0-ai-discovery.test.js
node test/web-access-guard.test.js
```

Expected: all localization, page, and guarded client/server contract tests pass.

- [ ] **Step 6: Commit the browser-client slice**

```bash
git add public/app-simple.js public/i18n.js test/i18n.test.js test/p0-ai-discovery.test.js
git commit -m "feat: bind browser compression to website sessions"
```

### Task 5: Full regression and browser verification

**Files:**
- Verify: all files changed in Tasks 1–4

**Interfaces:**
- Consumes: the final route, session, analytics, and browser-client behavior.
- Produces: a verified P0 implementation ready for deployment.

- [ ] **Step 1: Run syntax and whitespace checks**

Run:

```bash
git diff --check
node --check server-simple.js
node --check lib/web-session.js
node --check public/app-simple.js
node --check public/i18n.js
```

Expected: all commands exit 0.

- [ ] **Step 2: Run the complete automated suite**

Run:

```bash
npm test
```

Expected: all new and existing suites pass.

- [ ] **Step 3: Verify desktop routes in the in-app browser**

At a desktop viewport:

- `/` shows English and the Chinese link goes to `/zh/`;
- `/zh/` shows Chinese and the English link goes to `/`;
- `/faq` and `/zh/faq` show the correct language;
- `/en/` visibly resolves to `/`;
- no horizontal overflow, clipped copy, missing assets, or console warnings.

- [ ] **Step 4: Verify the normal compression entry path without completing a real file upload**

Confirm `/api/config` returns a request token after page navigation and the client includes it on upload submission. Confirm a direct request without the cookie receives `WEBSITE_SESSION_REQUIRED`.

- [ ] **Step 5: Verify basic 390px presentation**

At 390px, confirm text wraps, language navigation remains usable, and no horizontal overflow or mobile-only compression functionality appears.

- [ ] **Step 6: Inspect the final diff and status**

Confirm only intended files are staged/committed and preserve unrelated untracked user files.

- [ ] **Step 7: Commit any final verification fixes**

If visual or regression verification required changes, run the focused test first, make the smallest correction, rerun `npm test`, and commit:

```bash
git add server-simple.js lib/web-session.js lib/analytics.js public/app-simple.js public/i18n.js public/index.html public/faq.html public/zh/index.html public/zh/faq.html public/robots.txt public/sitemap.xml public/llms.txt test/web-session.test.js test/web-access-guard.test.js test/p0-ai-discovery.test.js test/i18n.test.js test/analytics-admin.test.js package.json
git commit -m "fix: complete link-only AI access verification"
```
