"use strict";

const assert = require("assert");
const {
  DEFAULT_GS_TIMEOUT_MS,
  MAX_ADAPTIVE_GS_TIMEOUT_MS,
  gsTimeoutMsForBytes,
} = require("../lib/gs-timeout");

const MB = 1024 * 1024;

assert.strictEqual(gsTimeoutMsForBytes(5 * MB, {}), DEFAULT_GS_TIMEOUT_MS);
assert.ok(gsTimeoutMsForBytes(10 * MB, {}) > 90_000, "complex 10MB PDFs must not be killed at the old 45s limit");
assert.ok(gsTimeoutMsForBytes(40 * MB, {}) > 90_000, "40MB PDFs need more than the two 45s probe windows");
assert.ok(gsTimeoutMsForBytes(40 * MB, {}) <= MAX_ADAPTIVE_GS_TIMEOUT_MS);
assert.strictEqual(gsTimeoutMsForBytes(40 * MB, { GS_TIMEOUT_MS: "240000" }), 240_000);
assert.strictEqual(gsTimeoutMsForBytes(40 * MB, { GS_TIMEOUT_MS: "1000" }), gsTimeoutMsForBytes(40 * MB, {}));
assert.strictEqual(gsTimeoutMsForBytes(200 * MB, {}), MAX_ADAPTIVE_GS_TIMEOUT_MS);

console.log("gs timeout regression test passed");
