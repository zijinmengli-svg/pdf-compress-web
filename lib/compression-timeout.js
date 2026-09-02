"use strict";

// Keep the asynchronous job alive long enough for slow, image-heavy PDFs on
// the free Render instance. Jobs are still bounded and cleaned up after one
// hour, so this is not an unbounded worker.
const DEFAULT_COMPRESSION_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_COMPRESSION_TIMEOUT_MS = 45 * 1000;

function compressionTimeoutMs(env = process.env, gsTimeoutMs = MIN_COMPRESSION_TIMEOUT_MS) {
  const minimum = Math.max(MIN_COMPRESSION_TIMEOUT_MS, Number(gsTimeoutMs) || 0);
  const configured = Number(env && env.COMPRESSION_TIMEOUT_MS);
  const requested = Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_COMPRESSION_TIMEOUT_MS;
  return Math.max(minimum, requested);
}

module.exports = {
  DEFAULT_COMPRESSION_TIMEOUT_MS,
  MIN_COMPRESSION_TIMEOUT_MS,
  compressionTimeoutMs,
};
