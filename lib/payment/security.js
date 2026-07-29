"use strict";

const crypto = require("crypto");

function hashAnonymousIdentity(sessionId, secret) {
  return crypto
    .createHmac("sha256", String(secret))
    .update(String(sessionId), "utf8")
    .digest("hex");
}

function hashOrderCapability(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

function createOrderCapability() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashOrderCapability(token) };
}

function verifyOrderCapability(token, expectedHash) {
  if (typeof token !== "string" || typeof expectedHash !== "string") {
    return false;
  }

  const actual = Buffer.from(hashOrderCapability(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = {
  hashAnonymousIdentity,
  createOrderCapability,
  hashOrderCapability,
  verifyOrderCapability,
};
