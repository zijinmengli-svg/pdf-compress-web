"use strict";

const assert = require("assert");
const { mergeRecentFileEvents } = require("../lib/analytics");

const MB = 1024 * 1024;

{
  const rows = mergeRecentFileEvents([
    {
      ts: "2026-09-09T11:59:00.000Z",
      event: "file_selected",
      sessionId: "session-1",
      data: { fileName: "portfolio.pdf", fileBytes: 62 * MB },
    },
    {
      ts: "2026-09-09T12:00:00.000Z",
      event: "compress_started",
      sessionId: "session-1",
      data: {
        fileName: "portfolio.pdf",
        fileBytes: 62 * MB,
        targetMB: 20,
        uploadAttemptId: "attempt-1",
      },
    },
    {
      ts: "2026-09-09T12:01:00.000Z",
      event: "compress_started",
      sessionId: "session-1",
      data: {
        fileName: "portfolio.pdf",
        fileBytes: 62 * MB,
        targetMB: 20,
        jobId: "job-1",
        uploadAttemptId: "attempt-1",
      },
    },
    {
      ts: "2026-09-09T12:09:00.000Z",
      event: "compress_success",
      sessionId: "session-1",
      data: {
        fileName: "portfolio.pdf",
        originalBytes: 62 * MB,
        targetMB: 20,
        resultBytes: 19 * MB,
        jobId: "job-1",
        uploadAttemptId: "attempt-1",
      },
    },
  ], new Date("2026-09-09T12:20:00.000Z"));

  assert.strictEqual(rows.length, 1, "one browser upload and its server job must remain one task");
  assert.strictEqual(rows[0].status, "success");
}

{
  const rows = mergeRecentFileEvents([
    {
      ts: "2026-09-08T12:00:00.000Z",
      event: "compress_started",
      sessionId: "legacy-session",
      data: { fileName: "legacy.pdf", fileBytes: 46 * MB, targetMB: 10 },
    },
    {
      ts: "2026-09-08T12:01:00.000Z",
      event: "compress_started",
      sessionId: "legacy-session",
      data: { fileName: "legacy.pdf", fileBytes: 46 * MB, targetMB: 10, jobId: "legacy-job" },
    },
    {
      ts: "2026-09-08T12:09:00.000Z",
      event: "compress_success",
      sessionId: "legacy-session",
      data: { fileName: "legacy.pdf", originalBytes: 46 * MB, targetMB: 10, resultBytes: 9.8 * MB, jobId: "legacy-job" },
    },
  ], new Date("2026-09-08T12:20:00.000Z"));

  assert.strictEqual(rows.length, 1, "legacy browser-only start events must not create phantom timeout rows");
  assert.strictEqual(rows[0].status, "success");
}

{
  const rows = mergeRecentFileEvents([
    {
      ts: "2026-09-09T12:00:00.000Z",
      event: "compress_started",
      sessionId: "session-2",
      data: { fileName: "large.pdf", fileBytes: 62 * MB, targetMB: 20, jobId: "job-2" },
    },
  ], new Date("2026-09-09T12:20:00.000Z"));

  assert.strictEqual(rows[0].status, "slow", "a valid 20-minute job is still processing");
  assert.match(rows[0].reason, /耗时较长|处理中/);
}

{
  const rows = mergeRecentFileEvents([
    {
      ts: "2026-09-09T12:00:00.000Z",
      event: "compress_started",
      sessionId: "session-3",
      data: { fileName: "lost.pdf", jobId: "job-3" },
    },
  ], new Date("2026-09-09T12:36:00.000Z"));

  assert.strictEqual(rows[0].status, "lost", "only a task silent beyond the workflow budget is lost");
  assert.match(rows[0].reason, /失联|未收到完成事件/);
}

{
  const rows = mergeRecentFileEvents([
    {
      ts: "2026-09-09T12:00:00.000Z",
      event: "compress_started",
      sessionId: "session-4",
      data: { fileName: "timed-out.pdf", jobId: "job-4" },
    },
    {
      ts: "2026-09-09T12:30:00.000Z",
      event: "compress_error",
      sessionId: "session-4",
      data: {
        fileName: "timed-out.pdf",
        jobId: "job-4",
        code: "COMPRESSION_TIMEOUT",
        reason: "Compression timed out after 1800000ms",
      },
    },
  ], new Date("2026-09-09T12:31:00.000Z"));

  assert.strictEqual(rows[0].status, "timeout", "an explicit server timeout must be labelled as a real timeout");
  assert.match(rows[0].reason, /timed out/);
}

{
  const rows = mergeRecentFileEvents([
    {
      ts: "2026-09-09T12:00:00.000Z",
      event: "compress_error",
      sessionId: "session-5",
      data: {
        fileName: "broken.pdf",
        jobId: "job-5",
        code: "COMPRESSION_ERROR",
        reason: "Invalid PDF",
      },
    },
  ], new Date("2026-09-09T12:01:00.000Z"));

  assert.strictEqual(rows[0].status, "error", "ordinary compression errors remain failures");
}

{
  const rows = mergeRecentFileEvents([
    {
      ts: "2026-09-09T12:01:00.000Z",
      event: "compress_started",
      sessionId: "session-6",
      data: { fileName: "same.pdf", jobId: "job-a", uploadAttemptId: "attempt-a" },
    },
    {
      ts: "2026-09-09T12:02:00.000Z",
      event: "compress_started",
      sessionId: "session-6",
      data: { fileName: "same.pdf", jobId: "job-b", uploadAttemptId: "attempt-b" },
    },
  ], new Date("2026-09-09T12:03:00.000Z"));

  assert.strictEqual(rows.length, 2, "real retries with the same filename must remain separate");
}

console.log("analytics processing status regression tests passed");
