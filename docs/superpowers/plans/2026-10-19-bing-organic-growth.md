# Bing Organic Growth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish and index ten useful English landing pages that can grow TinyPDF toward 500 unique overseas Bing download users per month.

**Architecture:** Work from the exact production branch, merge the five existing target-size pages without replacing current live assets, then add five intent-specific pages. Keep discovery standards-based with internal links, sitemap metadata, Bing Webmaster Tools, and IndexNow; measure success through first-touch Bing attribution carried to download.

**Tech Stack:** Node.js 20, static HTML/CSS/JavaScript, native Node tests, Render Docker deployment, Bing Webmaster Tools, IndexNow.

**Spec:** `docs/superpowers/specs/2026-10-19-bing-growth-and-capacity-design.md`

## Global Constraints

- Base implementation on `origin/feat/paddle-single-payment`, which matches the live Render deployment.
- Preserve all production UI, analytics, banner, session, compression, and payment-disabled behavior.
- No paid ads and no thin or duplicated doorway pages.
- Primary KPI is unique non-CN visitors who complete `download_clicked` after a Bing first touch.
- Do not expose admin credentials, API secrets, filenames, or IndexNow key material in logs.

## Review Focus

- Extensionless SEO routes must return `200`, not JSON `404`.
- Search crawlers must access public pages and sitemap while `/api/` and `/admin` remain blocked.
- First-touch Bing attribution must survive navigation from landing page to upload and download.
- Canonical and sitemap URLs must agree exactly, without duplicate `/en/` variants.
- Every intent page must remain usable without JavaScript until the compression form initializes.

---

### Task 1: Create A Production-Derived Worktree

**Files:**
- Create: isolated worktree based on `origin/feat/paddle-single-payment`
- Copy: this spec and both implementation plans into the worktree

**Interfaces:**
- Consumes: remote production branch at the commit currently served by Render
- Produces: isolated branch `codex/bing-organic-growth` with no user files modified

- [ ] **Step 1: Fetch production refs and verify live asset hashes**

Run hash comparisons for `/`, `/app-simple.js`, and `/sitemap.xml` against `origin/feat/paddle-single-payment`.

- [ ] **Step 2: Create the isolated worktree**

Use `superpowers:using-git-worktrees`; never reset or clean the user's existing dirty worktree.

- [ ] **Step 3: Run the current test suite**

Run: `npm test`

Expected: all existing tests pass before SEO changes.

### Task 2: Publish The Five Existing Target-Size Pages

**Files:**
- Create: `public/compress-pdf-to-1mb.html`
- Create: `public/compress-pdf-to-2mb.html`
- Create: `public/compress-pdf-to-5mb.html`
- Create: `public/compress-pdf-to-10mb.html`
- Create: `public/compress-pdf-to-20mb.html`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/sitemap.xml`
- Modify: `public/llms.txt`
- Test: `test/seo-landing-pages.test.js`

**Interfaces:**
- Consumes: content from commit `d251ee1` and current production UI assets
- Produces: five extensionless public routes with a preset `targetMB`

- [ ] **Step 1: Write failing route and metadata tests**

Assert that all five routes return `200`, include one canonical URL, include `index, follow`, expose a compressor form, and preset the expected target size.

- [ ] **Step 2: Run the SEO test and verify it fails**

Run: `node test/seo-landing-pages.test.js`

Expected: FAIL because the production branch lacks these pages.

- [ ] **Step 3: Port the five pages without replacing current production assets**

Bring page content and shared styles from `d251ee1`; update script/style references to the current production versions and preserve the current UI shell.

- [ ] **Step 4: Add internal links and sitemap entries**

Add links from the English homepage and include canonical URLs with accurate `lastmod` values in `public/sitemap.xml`.

- [ ] **Step 5: Run SEO and full tests**

Run: `node test/seo-landing-pages.test.js && npm test`

Expected: PASS.

### Task 3: Add Five High-Intent English Pages

**Files:**
- Create: `public/compress-portfolio-pdf.html`
- Create: `public/compress-pdf-for-job-application.html`
- Create: `public/compress-figma-pdf.html`
- Create: `public/compress-pdf-for-email.html`
- Create: `public/compress-pdf-without-losing-quality.html`
- Modify: `public/index.html`
- Modify: `public/faq.html`
- Modify: `public/sitemap.xml`
- Test: `test/seo-landing-pages.test.js`

**Interfaces:**
- Consumes: the working compressor page pattern from Task 2
- Produces: five pages mapped to concrete overseas search jobs

- [ ] **Step 1: Extend tests for unique intent and metadata**

Assert unique title, H1, description, canonical, visible caveats, form, target guidance, and internal links for every page. Add a pairwise repeated-text threshold to catch accidental near duplicates.

- [ ] **Step 2: Run tests and verify they fail**

Run: `node test/seo-landing-pages.test.js`

- [ ] **Step 3: Implement the five pages**

Each page must answer its query directly, explain quality trade-offs honestly, and use examples specific to that workflow.

- [ ] **Step 4: Add internal topic navigation**

Link related size and use-case pages without adding a marketing landing page or card-heavy content hub.

- [ ] **Step 5: Run full tests and inspect desktop/mobile rendering**

Run: `npm test`

Use Playwright screenshots at desktop and mobile widths; confirm no overflow, duplicate H1, or broken compressor controls.

### Task 4: Preserve Bing Attribution Through Download

**Files:**
- Modify: `lib/web-session.js`
- Modify: `lib/analytics.js`
- Modify: `server-simple.js`
- Modify: `public/admin.js`
- Test: `test/web-session.test.js`
- Test: `test/analytics-admin.test.js`

**Interfaces:**
- Consumes: landing referrer, UTM values, requested page path, language, and country
- Produces: first-touch source/path and last-touch source/path on every funnel event

- [ ] **Step 1: Add failing first-touch tests**

Cover Bing landing, internal navigation, a two-hour session renewal, download attribution, and `libindesign.cn` owned referral.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node test/web-session.test.js && node test/analytics-admin.test.js`

- [ ] **Step 3: Persist landing path and first-touch attribution in the signed session**

Add bounded `landingPath` and immutable first-touch fields; never store search query text that could contain personal information.

- [ ] **Step 4: Export and display Bing landing-page conversions**

Add dashboard rows for visits, unique visitors, file selections, successful compressions, and downloads by landing page and country.

- [ ] **Step 5: Run full tests**

Run: `npm test`

### Task 5: Add IndexNow Submission

**Files:**
- Create: `scripts/submit-indexnow.js`
- Modify: `server-simple.js`
- Modify: `package.json`
- Test: `test/indexnow.test.js`

**Interfaces:**
- Consumes: `INDEXNOW_KEY`, public sitemap URLs, production host
- Produces: validated key endpoint and batch submission command

- [ ] **Step 1: Write failing validation tests**

Cover missing key, malformed key, key-file response, sitemap parsing, non-production host rejection, success, `202`, rate limiting, and network failure.

- [ ] **Step 2: Run the test and verify failure**

Run: `node test/indexnow.test.js`

- [ ] **Step 3: Implement the key endpoint and submission script**

Use only HTTPS URLs belonging to `tinypdf.cn`; print counts and status, never print the key.

- [ ] **Step 4: Add npm command**

Add `npm run indexnow:submit`.

- [ ] **Step 5: Run full tests**

Run: `npm test`

### Task 6: Deploy And Register With Bing

**Files:**
- Modify: Render environment with `INDEXNOW_KEY`
- External: Bing Webmaster Tools site verification and sitemap registration

**Interfaces:**
- Consumes: tested production branch and verified Bing account
- Produces: live pages returning `200`, accepted sitemap, submitted IndexNow URLs

- [ ] **Step 1: Deploy the tested branch to Render**

Record the pre-deploy commit and verify health before traffic is sent.

- [ ] **Step 2: Verify all ten live routes and sitemap**

Run HTTP checks for status, canonical, robots, and response time.

- [ ] **Step 3: Complete Bing ownership verification**

The user handles Microsoft login or any CAPTCHA; the agent can complete non-sensitive page and DNS/file steps after the verification token is available.

- [ ] **Step 4: Submit `https://tinypdf.cn/sitemap.xml` and run IndexNow**

Confirm acceptance; do not claim ranking or indexing until Bing reports it.

- [ ] **Step 5: Establish weekly measurement**

Record indexed pages, impressions, clicks, overseas Bing visits, and unique completed downloads every seven days.

