# Independent Email Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship standalone email-code sign-in without deploying or depending on Paddle.

**Architecture:** A focused PostgreSQL auth store and Resend sender sit behind four `/api/auth/*` routes. A small bilingual header dialog drives request, verify, session display, and logout. Existing anonymous compression remains unchanged.

**Tech Stack:** Node.js 18+, `pg`, `pg-mem` tests, vanilla HTML/CSS/JS.

**Spec:** `docs/superpowers/specs/2026-10-25-independent-email-login-design.md`

## Global Constraints

- Do not import `lib/payment`, `lib/referral`, Paddle, or credit tables.
- Do not change compression eligibility or introduce a login gate.
- No production secrets in source, test output, or frontend.
- Use the deployed homepage commit as the baseline and keep `BILLING_ENABLED=false`.

## Review Focus

- Invalid, expired, or exhausted codes do not create accounts or sessions.
- Multiple same-email requests and multiple tabs cannot bypass cooldown/attempt limits.
- Email delivery failure does not leave a usable challenge.
- Login and logout cookies have correct flags and cannot be forged with a different website session.
- Missing database or sender config leaves compression operational and visibly disables login.

---

### Task 1: Standalone auth service and schema

**Files:** Create `lib/auth/schema.sql`, `lib/auth/service.js`, `lib/auth/email-sender.js`; test `test/email-auth.test.js`.

**Interfaces:** `createEmailAuthService({pool, secret, sendCode, now})` returns `ready`, `requestCode({email,ip})`, `verifyCode({email,code})`, `getSession(token)`, `logout(token)`. `createEmailSender({apiKey,from,fetchImpl})` returns `(email, code) => Promise<void>`.

- [ ] Write tests for normalization, cooldown/hourly limits, expired/wrong/exhausted code, delivery failure, account reuse, session expiry and logout.
- [ ] Run `node test/email-auth.test.js` and see expected feature failures.
- [ ] Implement independent schema/service/sender with hashed codes and tokens, parameterized queries, transactions, and bounded retention.
- [ ] Run the auth tests and confirm all pass.

### Task 2: HTTP route integration

**Files:** Create `lib/auth/routes.js`; modify `server-simple.js`; test `test/email-auth-routes.test.js`.

**Interfaces:** `createEmailAuthRoutes({getService, website, readJson, json, sendError, parseCookies})` handles `/api/auth/me`, `/request-code`, `/verify`, `/logout`; `handle(req,res,url)` returns boolean.

- [ ] Write HTTP tests for auth availability, CSRF/web-session gate, request/verify/me/logout, and missing configuration.
- [ ] Run route tests and see expected failures.
- [ ] Wire routes without changing jobs, billing, or existing session semantics.
- [ ] Run route tests and then `npm test` successfully.

### Task 3: Bilingual login UI

**Files:** Create `public/email-login.js`, `public/email-login.css`; modify `public/index.html`, `public/zh/index.html`; test `test/email-login-ui.test.js`.

**Interfaces:** A header `#email-login-button` opens the modal; the script fetches `/api/config` token, then the auth endpoints; active account is shown on load and after verification.

- [ ] Write browser-facing tests for always-visible login, email/code validation, success, refresh, language-switch continuity, logout, and error state.
- [ ] Run tests to observe the missing UI fail.
- [ ] Implement the smallest bilingual dialog and header styles consistent with existing site.
- [ ] Run UI tests and complete suite; manually inspect desktop/mobile.

### Task 4: Release isolation and acceptance

**Files:** Update deployment notes and only auth-related tests/files; no payment files.

- [ ] Run `npm test`, browser acceptance, and `git diff --check`.
- [ ] Verify Git diff against `85ce414` contains only auth files, two homepages, and deployment notes.
- [ ] Run local real-email acceptance with approved mailbox without saving the key or code to source/logs.
- [ ] Commit the isolated branch; deploy only after verification and confirm `/api/auth/me` and sign-in online, with billing off.
