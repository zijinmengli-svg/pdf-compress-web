"use strict";

const crypto = require("crypto");

const DAY_MS = 24 * 60 * 60 * 1000;

function requireSecret(secret) {
  const value = String(secret || "");
  if (!value) throw new TypeError("wallet secret is required");
  return value;
}

function sign(payload, secret) {
  return crypto.createHmac("sha256", requireSecret(secret)).update(payload).digest("base64url");
}

function createWalletCookie({ walletId, secret, now = new Date(), maxAgeDays = 365 }) {
  if (!String(walletId || "").trim()) throw new TypeError("walletId is required");
  const issuedAt = new Date(now).getTime();
  const expiresAt = issuedAt + Number(maxAgeDays) * DAY_MS;
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) throw new TypeError("valid wallet time is required");
  const payload = Buffer.from(JSON.stringify({ walletId: String(walletId), issuedAt, expiresAt }), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

function verifyWalletCookie({ value, secret, now = new Date() }) {
  try {
    const [payload, signature] = String(value || "").split(".");
    if (!payload || !signature) return null;
    const expected = sign(payload, secret);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded || !String(decoded.walletId || "").trim() || !Number.isSafeInteger(decoded.issuedAt) || !Number.isSafeInteger(decoded.expiresAt)) return null;
    if (decoded.expiresAt <= decoded.issuedAt || new Date(now).getTime() >= decoded.expiresAt) return null;
    return { walletId: decoded.walletId, issuedAt: decoded.issuedAt, expiresAt: decoded.expiresAt };
  } catch {
    return null;
  }
}

function keyedHash(value, secret) {
  return crypto.createHmac("sha256", requireSecret(secret)).update(String(value || "")).digest("hex");
}

function hashWalletId(walletId, secret) { return keyedHash(walletId, secret); }

function createInviteCode({ walletId, secret } = {}) {
  if (walletId && secret) return crypto.createHmac("sha256", requireSecret(secret)).update(`invite:${walletId}`).digest("base64url").slice(0, 32);
  return crypto.randomBytes(18).toString("base64url");
}

function hashInviteCode(code, secret) { return keyedHash(code, secret); }

module.exports = {
  DAY_MS,
  createWalletCookie,
  verifyWalletCookie,
  hashWalletId,
  createInviteCode,
  hashInviteCode,
};
