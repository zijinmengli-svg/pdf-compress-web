# 500 Monthly Downloads Capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current Render deployment safely handle a target of 500 completed overseas downloads per month without out-of-memory crashes or silent overload.

**Architecture:** Keep one Node service and the existing Ghostscript engine, but derive conservative concurrency from environment configuration and protect memory-heavy uploads. Validate capacity with representative PDFs and promote the Render plan only when measured latency, memory, or busy responses cross defined thresholds.

**Tech Stack:** Node.js 20, Ghostscript 10.03.1, Render Web Service, native Node tests, shell load test.

**Spec:** `docs/superpowers/specs/2026-10-19-bing-growth-and-capacity-design.md`

## Global Constraints

- Current production is Render Free: 0.1 CPU, 512 MB RAM, one instance, idle spin-down.
- Do not increase server-side concurrency without measured memory headroom.
- Uploaded and generated PDFs remain temporary and are deleted after the existing retention window.
- Busy responses must be explicit and retryable; never leave the UI indefinitely processing.
- Capacity tests must use synthetic or approved PDFs, never user analytics filenames or documents.

## Review Focus

- Two near-100 MB uploads must not allocate enough memory to kill the process.
- Ghostscript child processes must terminate on timeout and release temporary files.
- A full server must return `429` plus `Retry-After`, not accept a doomed job.
- Restart during an in-memory job must produce a clear client error and permit retry.
- Cold start and one active compression must not make health checks fail.

---

### Task 1: Make Capacity Limits Environment-Aware

**Files:**
- Modify: `server-simple.js`
- Modify: `public/app-simple.js`
- Test: `test/capacity-guard.test.js`

**Interfaces:**
- Consumes: `MAX_INFLIGHT_UPLOADS`, `MAX_CONCURRENT_JOBS`, `RENDER_CPU_COUNT`
- Produces: validated limits and retryable busy responses

- [ ] **Step 1: Write failing configuration tests**

Assert a Render Free default of one in-flight upload and one active server job, explicit environment overrides within safe bounds, and invalid-value fallback.

- [ ] **Step 2: Run the test and verify failure**

Run: `node test/capacity-guard.test.js`

- [ ] **Step 3: Implement validated capacity configuration**

Expose non-sensitive limits through `/api/config`; include `Retry-After: 30` on `TOO_BUSY` responses.

- [ ] **Step 4: Add user-facing retry behavior**

Show a plain busy message and one retry action; do not automatically loop uploads.

- [ ] **Step 5: Run full tests**

Run: `npm test`

### Task 2: Remove Whole-Request Upload Buffering

**Files:**
- Create: `lib/multipart-upload.js`
- Modify: `server-simple.js`
- Test: `test/multipart-upload.test.js`

**Interfaces:**
- Consumes: request stream, boundary, maximum bytes, temporary directory
- Produces: `{ filePath, filename, fields, byteLength, cleanup() }`

- [ ] **Step 1: Write failing streaming tests**

Cover valid PDF, 100 MB boundary, over-limit abort, malformed boundary, client disconnect, duplicate file parts, and cleanup.

- [ ] **Step 2: Run the test and verify failure**

Run: `node test/multipart-upload.test.js`

- [ ] **Step 3: Implement bounded streaming multipart parsing**

Write file bytes directly to a temporary file and retain only bounded form fields in memory.

- [ ] **Step 4: Replace `handleMultipart` in the job route**

Preserve file signature validation, analytics size values, and cleanup on every error path.

- [ ] **Step 5: Run full tests**

Run: `npm test`

### Task 3: Add Capacity Observability

**Files:**
- Modify: `server-simple.js`
- Modify: `lib/analytics.js`
- Modify: `public/admin.js`
- Test: `test/analytics-admin.test.js`

**Interfaces:**
- Consumes: job timestamps, process RSS, busy responses, compression outcomes
- Produces: aggregate capacity metrics without storing document contents

- [ ] **Step 1: Write failing aggregation tests**

Cover peak active jobs, peak RSS, p50/p95 compression duration, busy response count, and timeout count.

- [ ] **Step 2: Implement bounded operational events**

Record numeric metrics only; do not add IP addresses or PDF contents.

- [ ] **Step 3: Render the capacity section in the Chinese admin dashboard**

Show last 7 and 30 days, including busy rate and p95 duration.

- [ ] **Step 4: Run full tests**

Run: `npm test`

### Task 4: Run A Representative Load Test

**Files:**
- Create: `scripts/load-test-capacity.js`
- Create: `docs/capacity-baseline.md`

**Interfaces:**
- Consumes: approved synthetic 10 MB, 40 MB, and 100 MB PDFs
- Produces: reproducible latency, success, busy-rate, and memory baseline

- [ ] **Step 1: Implement a same-origin session-aware load client**

Exercise sequential load and bursts of two and five users without bypassing website request protections.

- [ ] **Step 2: Run locally in the Docker image**

Record process RSS, child-process count, p50/p95 duration, success rate, and cleanup behavior.

- [ ] **Step 3: Run a low-volume production smoke test**

Use one small synthetic PDF and never run a stress burst against production.

- [ ] **Step 4: Write the capacity decision**

Keep Free only if one-job p95 completes within the UI timeout, peak RSS stays below 400 MB, and valid busy rate remains below 2%.

### Task 5: Set The Render Upgrade Trigger

**Files:**
- Modify: `docs/payment-deployment.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the measured baseline from Task 4
- Produces: an explicit operational threshold for changing compute plan

- [ ] **Step 1: Document the Free-plan limit**

State that it is a controlled-launch tier, not a guaranteed production tier.

- [ ] **Step 2: Define upgrade thresholds**

Upgrade to `0.5c-512mb` when cold starts or CPU latency materially reduce download conversion. Upgrade to `1c-2g` before more than one Ghostscript job or sustained large-file bursts.

- [ ] **Step 3: Verify rollback instructions**

Record the last known-good commit and verify that changing compute plan does not modify data stores or payment configuration.

