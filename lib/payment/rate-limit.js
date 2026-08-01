"use strict";

const crypto = require("crypto");

function normalizeIpPrefix(value) {
  const address = String(value || "").trim();
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return address.split(".").slice(0, 3).join(".");
  if (address.includes(":")) return address.split(":").slice(0, 4).join(":").toLowerCase();
  return "unknown";
}

function createSlidingWindowLimiter({ limit, windowMs, now = () => new Date(), secret = "" }) {
  const buckets = new Map();
  const max = Number(limit);
  const window = Number(windowMs);
  if (!Number.isInteger(max) || max < 1 || !Number.isFinite(window) || window <= 0) throw new TypeError("valid limit and windowMs are required");
  const hash = (value) => crypto.createHmac("sha256", String(secret)).update(value).digest("hex");
  return {
    allow({ sessionId, ipPrefix }) {
      const timestamp = now().getTime();
      const keys = [`session:${hash(String(sessionId || ""))}`, `ip:${hash(normalizeIpPrefix(ipPrefix))}`];
      for (const key of keys) {
        const current = (buckets.get(key) || []).filter((time) => time > timestamp - window);
        if (current.length >= max) return false;
      }
      for (const key of keys) buckets.set(key, [...(buckets.get(key) || []).filter((time) => time > timestamp - window), timestamp]);
      return true;
    },
    normalizeIpPrefix,
  };
}

module.exports = { createSlidingWindowLimiter, normalizeIpPrefix };
