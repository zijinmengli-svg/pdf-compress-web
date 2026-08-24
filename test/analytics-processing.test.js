"use strict";

const assert = require("assert");
const { mergeRecentFileEvents } = require("../lib/analytics");

const now = new Date("2026-08-24T12:20:00.000Z");
const rows = mergeRecentFileEvents([
  {
    ts: "2026-08-24T12:00:00.000Z",
    event: "compress_started",
    sessionId: "session-1",
    data: { fileName: "small.pdf", fileBytes: 12 * 1024, targetMB: 0.01, jobId: "job-1" },
  },
], now);

assert.strictEqual(rows.length, 1);
assert.strictEqual(rows[0].status, "timeout");
assert.match(rows[0].reason, /超时|服务器重启/);
console.log("analytics processing timeout regression test passed");

const retriedRows = mergeRecentFileEvents([
  { ts: "2026-08-24T12:01:00.000Z", event: "compress_started", sessionId: "session-2", data: { fileName: "same.pdf", jobId: "job-a" } },
  { ts: "2026-08-24T12:02:00.000Z", event: "compress_started", sessionId: "session-2", data: { fileName: "same.pdf", jobId: "job-b" } },
], now);
assert.strictEqual(retriedRows.length, 2, "different jobs with the same filename must remain separate");
