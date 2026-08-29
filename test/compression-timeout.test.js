"use strict";

const assert = require("assert");
const { DEFAULT_COMPRESSION_TIMEOUT_MS, compressionTimeoutMs } = require("../lib/compression-timeout");

// A 9.55MB portfolio targeting 5MB previously failed at the hard 180s cutoff.
// The default budget must leave enough time for vector probes plus raster fallback.
assert.ok(DEFAULT_COMPRESSION_TIMEOUT_MS > 180_000);
assert.strictEqual(compressionTimeoutMs({}), DEFAULT_COMPRESSION_TIMEOUT_MS);
assert.strictEqual(compressionTimeoutMs({ COMPRESSION_TIMEOUT_MS: "240000" }), 240_000);
assert.strictEqual(compressionTimeoutMs({ COMPRESSION_TIMEOUT_MS: "1000" }), 45_000);

console.log("compression timeout regression test passed");
