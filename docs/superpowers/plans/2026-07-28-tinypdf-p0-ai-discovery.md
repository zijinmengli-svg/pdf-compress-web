# TinyPDF P0 AI Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a crawlable Chinese default homepage and English `/en/` version with explicit AI search crawler rules, consistent product facts, localized runtime copy, and desktop-first responsive presentation.

**Architecture:** Keep the existing native HTML/CSS/JavaScript application and server. Add stable static language routes and a tested browser/Node-compatible translation dictionary; extend the static server only for `/en/` directory index resolution. Preserve the compression backend and server-side funnel events.

**Tech Stack:** Node.js 18+, native HTTP server, static HTML/CSS/JavaScript, Node `assert` tests.

## Global Constraints

- Desktop web is the only maintained product workflow.
- Mobile receives basic responsive display only; do not add mobile-specific functionality or detailed mobile workflow handling.
- `/` is Chinese and `/en/` is English.
- Preserve compression behavior, admin behavior, upload limits, ad hooks, and existing analytics summaries.
- Do not add unsupported claims, ratings, user counts, or guaranteed target-size promises.
- Do not change Cloudflare settings from code; report the external verification step separately.

---

### Task 1: P0 crawl and language-route contract

**Files:**
- Create: `test/p0-ai-discovery.test.js`
- Modify: `server-simple.js`
- Modify: `public/robots.txt`
- Modify: `public/sitemap.xml`

**Interfaces:**
- Consumes: existing `handleStatic(req, res, url)` and static `public/` files.
- Produces: HTTP 200 routes for `/`, `/faq`, `/en/`, `/en/faq`, explicit crawler rules, and sitemap language URLs.

- [ ] **Step 1: Write the failing integration test**

Create a server harness that starts `server-simple.js` and asserts:

```js
assert.strictEqual((await get("/en/")).status, 200);
assert.match((await get("/robots.txt")).body, /User-agent: Bytespider\s+Allow: \//);
assert.match((await get("/robots.txt")).body, /User-agent: GPTBot\s+Disallow: \//);
assert.match((await get("/sitemap.xml")).body, /https:\/\/tinypdf\.cn\/en\//);
```

The test must also verify `/admin` remains disallowed for the wildcard crawler.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node test/p0-ai-discovery.test.js
```

Expected: FAIL because `/en/` is not routed and explicit AI crawler blocks are absent.

- [ ] **Step 3: Implement crawl rules and route resolution**

In `handleStatic`, map `/en` and `/en/` to `/en/index.html` before extension fallback:

```js
if (pathname === "/") pathname = "/index.html";
else if (pathname === "/en" || pathname === "/en/") pathname = "/en/index.html";
else if (!path.extname(pathname)) pathname += ".html";
```

Update `robots.txt` with explicit allow rules for search/user agents and disallow rules for training agents. Add `/en/`, `/en/faq`, and both language alternates to the sitemap.

- [ ] **Step 4: Run the integration test and verify GREEN**

Run:

```bash
node test/p0-ai-discovery.test.js
```

Expected: all checks pass.

### Task 2: Tested runtime localization

**Files:**
- Create: `test/i18n.test.js`
- Create: `public/i18n.js`
- Modify: `public/app-simple.js`

**Interfaces:**
- Produces: `TinyPDFI18n.createTranslator(language)` returning `{ language, text(key, vars) }`.
- Consumes: the translator from `window.TinyPDFI18n` in `app-simple.js`.

- [ ] **Step 1: Write the failing dictionary test**

Test the wished-for API:

```js
const { createTranslator } = require("../public/i18n.js");
const zh = createTranslator("zh-CN");
const en = createTranslator("en");
assert.strictEqual(zh.text("compressButton"), "开始压缩");
assert.strictEqual(en.text("compressButton"), "Compress PDF");
assert.strictEqual(zh.text("uploadLimit", { max: 100 }), "免费使用 · 无需注册 · 单个文件最高 100MB");
assert.strictEqual(createTranslator("fr").language, "en");
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node test/i18n.test.js
```

Expected: FAIL because `public/i18n.js` does not exist.

- [ ] **Step 3: Implement the minimal dictionary**

Create a UMD-style module with Chinese and English strings used by the current interface. Placeholder replacement uses `{name}` syntax:

```js
function format(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}
```

Expose `{ createTranslator, messages }` through both `module.exports` and `window.TinyPDFI18n`.

- [ ] **Step 4: Run the unit test and verify GREEN**

Run:

```bash
node test/i18n.test.js
```

Expected: all checks pass.

- [ ] **Step 5: Integrate the translator**

In `app-simple.js`, initialize:

```js
const i18n = window.TinyPDFI18n.createTranslator(document.documentElement.lang);
const t = (key, vars) => i18n.text(key, vars);
```

Replace visible hard-coded messages with dictionary lookups. Include `landingLanguage: i18n.language` in client tracking data. Add a debounced `target_entered` event after a valid target value changes.

### Task 3: Crawlable Chinese and English pages

**Files:**
- Modify: `public/index.html`
- Modify: `public/faq.html`
- Create: `public/en/index.html`
- Create: `public/en/faq.html`

**Interfaces:**
- Consumes: `/styles.css`, `/i18n.js`, `/app-simple.js`, `/ad-slot.js`.
- Produces: self-contained crawlable HTML for both languages.

- [ ] **Step 1: Extend the integration test with failing page assertions**

Assert:

```js
assert.match(chineseHome.body, /<html lang="zh-CN">/);
assert.match(chineseHome.body, /将 PDF 压缩到指定大小/);
assert.match(chineseHome.body, /hreflang="en"/);
assert.match(englishHome.body, /<html lang="en">/);
assert.match(englishHome.body, /Compress a PDF to a target file size/);
assert.match(englishHome.body, /hreflang="zh-CN"/);
```

Also assert each page has a self-referencing canonical URL and loads `/i18n.js` before `/app-simple.js`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node test/p0-ai-discovery.test.js
```

Expected: FAIL because the Chinese and English documents are not present.

- [ ] **Step 3: Implement the pages**

Turn `public/index.html` and `public/faq.html` into Chinese documents. Copy the existing English content to `public/en/index.html` and `public/en/faq.html`, update their canonical and `hreflang` URLs, and add visible language links.

The Chinese hero must use:

```text
TinyPDF
将 PDF 压缩到指定大小
输入目标文件大小，TinyPDF 会尽可能在保留页数、页面尺寸和版式的同时，把 PDF 压缩到接近你需要的大小。
```

Both homepages must state temporary processing, about-one-hour deletion, and the target/quality limitation in visible text.

- [ ] **Step 4: Run the page integration test and verify GREEN**

Run:

```bash
node test/p0-ai-discovery.test.js
```

Expected: all route, metadata, and content checks pass.

### Task 4: Desktop-first responsive presentation

**Files:**
- Modify: `public/styles.css`
- Modify: `test/p0-ai-discovery.test.js`

**Interfaces:**
- Produces: wrapping hero copy and basic narrow-screen layout without mobile-only controls.

- [ ] **Step 1: Add a failing CSS contract**

Assert the `.lead` rule does not contain `white-space: nowrap` or `text-overflow: ellipsis`, and the narrow-screen block contains:

```css
.topbar,
.footer-inner {
  align-items: flex-start;
}
```

Assert the HTML does not contain mobile target preset controls.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node test/p0-ai-discovery.test.js
```

Expected: FAIL because the lead still truncates.

- [ ] **Step 3: Implement the minimal responsive changes**

Allow `.lead` to wrap, add `overflow-wrap: anywhere`, improve footer link gaps/wrapping, and stack the top bar only at narrow widths. Do not add new mobile functionality.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```bash
node test/p0-ai-discovery.test.js
```

Expected: all checks pass.

### Task 5: Full regression and visual verification

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: the two new test files.
- Produces: the new tests in the normal `npm test` gate.

- [ ] **Step 1: Add tests to the package script**

Run `test/i18n.test.js` and `test/p0-ai-discovery.test.js` before the existing suite.

- [ ] **Step 2: Run all automated checks**

Run:

```bash
npm test
```

Expected: exit 0 with every suite passing.

- [ ] **Step 3: Start the local server**

Run:

```bash
PORT=3487 HOST=127.0.0.1 node server-simple.js
```

Open `/` and `/en/` at 1440px, then inspect `/` at 390px. Verify no text clipping, horizontal overflow, missing assets, or broken desktop controls.

- [ ] **Step 4: Verify HTTP assets and crawl files**

Check `/robots.txt`, `/sitemap.xml`, `/faq`, and `/en/faq` return 200 and contain the expected language/crawl metadata.

