"use strict";

const DEFAULT_GS_TIMEOUT_MS = 45 * 1000;
const MIN_GS_TIMEOUT_MS = 5 * 1000;
const MAX_ADAPTIVE_GS_TIMEOUT_MS = 180 * 1000;
const ADAPTIVE_START_MB = 20;
const ADAPTIVE_START_TIMEOUT_MS = 60 * 1000;
const ADAPTIVE_PER_MB_MS = 3 * 1000;
const MB = 1024 * 1024;

/**
 * Return the timeout for one Ghostscript invocation.
 *
 * Ghostscript work scales with both input size and page/image complexity. A
 * fixed 45s limit is fine for small PDFs but causes a large PDF to be killed
 * during the first vector probe and again during raster fallback. The adaptive
 * floor gives larger inputs time to finish while retaining the environment
 * variable as an operator override and a hard upper bound for runaway jobs.
 */
function gsTimeoutMsForBytes(inputBytes, env = process.env) {
  const configured = Number(env && env.GS_TIMEOUT_MS);
  const base = Math.max(
    MIN_GS_TIMEOUT_MS,
    Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_GS_TIMEOUT_MS
  );
  const bytes = Number(inputBytes);
  if (!Number.isFinite(bytes) || bytes <= ADAPTIVE_START_MB * MB) return base;

  const sizeMbOverStart = (bytes / MB) - ADAPTIVE_START_MB;
  const adaptiveFloor = Math.min(
    MAX_ADAPTIVE_GS_TIMEOUT_MS,
    ADAPTIVE_START_TIMEOUT_MS + Math.ceil(sizeMbOverStart) * ADAPTIVE_PER_MB_MS
  );
  return Math.max(base, adaptiveFloor);
}

module.exports = {
  DEFAULT_GS_TIMEOUT_MS,
  MIN_GS_TIMEOUT_MS,
  MAX_ADAPTIVE_GS_TIMEOUT_MS,
  gsTimeoutMsForBytes,
};
