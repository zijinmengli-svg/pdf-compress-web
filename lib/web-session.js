"use strict";

const crypto = require("crypto");
const { normalizeUtm } = require("./analytics");

const WEB_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_REFERRER_LENGTH = 600;
const MAX_ATTRIBUTION_FIELD_LENGTH = 160;

function bounded(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function boundedUtm(utm) {
  const normalized = normalizeUtm(utm);
  return Object.fromEntries(
    Object.entries(normalized).map(([key, value]) => [
      key,
      bounded(value, MAX_ATTRIBUTION_FIELD_LENGTH),
    ])
  );
}

function sanitizeReferrer(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return bounded(`${parsed.protocol}//${parsed.host}${parsed.pathname}`, MAX_REFERRER_LENGTH);
  } catch {
    return "";
  }
}

function isLibinDesignHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return host === "libindesign.cn" || host === "www.libindesign.cn";
}

function isKnownAiReferralHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return [
    "chatgpt.com",
    "perplexity.ai",
    "claude.ai",
    "gemini.google.com",
    "copilot.microsoft.com",
  ].some(domain => host === domain || host.endsWith(`.${domain}`));
}

function normalizeLandingAttribution(referrer, utm) {
  const normalizedUtm = boundedUtm(utm);
  const cleanReferrer = sanitizeReferrer(referrer);
  let hostname = "";
  if (cleanReferrer) {
    try {
      hostname = new URL(cleanReferrer).hostname.toLowerCase().replace(/^www\./, "");
    } catch {}
  }

  if (normalizedUtm.source) {
    const source = normalizedUtm.source;
    const sourceHost = source.toLowerCase().replace(/^www\./, "");
    const sourceCategory =
      isLibinDesignHost(sourceHost) ? "owned_referral" :
      isKnownAiReferralHost(sourceHost) ? "ai_referral" :
      "campaign";
    return {
      referrer: cleanReferrer,
      utm: normalizedUtm,
      source,
      sourceCategory,
    };
  }

  if (!hostname) {
    return {
      referrer: "",
      utm: normalizedUtm,
      source: "Direct",
      sourceCategory: "direct",
    };
  }

  return {
    referrer: cleanReferrer,
    utm: normalizedUtm,
    source: isLibinDesignHost(hostname) ? "libindesign.cn" : hostname,
    sourceCategory:
      isLibinDesignHost(hostname) ? "owned_referral" :
      isKnownAiReferralHost(hostname) ? "ai_referral" :
      "referral",
  };
}

function hmac(secret, value) {
  return crypto.createHmac("sha256", String(secret || "")).update(String(value || "")).digest("base64url");
}

function safeEqual(first, second) {
  const left = Buffer.from(String(first || ""));
  const right = Buffer.from(String(second || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createWebSession(secret, landing = {}, now = new Date()) {
  const currentTime = now instanceof Date ? now.getTime() : Number(now);
  const claims = {
    sid: crypto.randomUUID(),
    iat: currentTime,
    exp: currentTime + WEB_SESSION_MAX_AGE_MS,
    attribution: normalizeLandingAttribution(landing.referrer, landing.utm),
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return {
    value: `${payload}.${hmac(secret, payload)}`,
    claims,
  };
}

function verifyWebSession(value, secret, now = new Date()) {
  try {
    const [payload, signature, extra] = String(value || "").split(".");
    if (!payload || !signature || extra) return null;
    if (!safeEqual(signature, hmac(secret, payload))) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const currentTime = now instanceof Date ? now.getTime() : Number(now);
    if (!claims || typeof claims.sid !== "string" || !claims.sid) return null;
    if (!Number.isFinite(claims.iat) || !Number.isFinite(claims.exp)) return null;
    if (claims.iat > currentTime + 5 * 60 * 1000 || claims.exp <= currentTime) return null;
    if (!claims.attribution || typeof claims.attribution !== "object") return null;
    return claims;
  } catch {
    return null;
  }
}

function requestTokenFor(sessionValue, secret) {
  return hmac(secret, `request:${sessionValue}`);
}

function verifyRequestToken(sessionValue, token, secret) {
  if (!sessionValue || !token) return false;
  return safeEqual(token, requestTokenFor(sessionValue, secret));
}

function isAutomatedUserAgent(userAgent) {
  const ua = String(userAgent || "");
  if (!ua) return true;
  return /bot|crawl|spider|slurp|monitor|healthcheck|uptime|pingdom|curl|wget|python-requests|headless|lighthouse|node-fetch|axios|okhttp|go-http|java\/|libwww|scrapy|ahrefs|semrush|mj12|facebookexternalhit|yandex|baidu|sogou|oai-searchbot|claude-searchbot|claude-user|perplexity|bytespider/i.test(ua);
}

function requestSourceUrl(req) {
  const headers = (req && req.headers) || {};
  return headers.origin || headers.referer || headers.referrer || "";
}

function isSameOriginRequest(req) {
  const headers = (req && req.headers) || {};
  if (String(headers["sec-fetch-site"] || "").toLowerCase() !== "same-origin") return false;
  const host = String(headers.host || "").toLowerCase();
  const source = requestSourceUrl(req);
  if (!host || !source) return false;
  try {
    return new URL(source).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function createJobAccess(sessionClaims) {
  return {
    ownerSessionId: String(sessionClaims && sessionClaims.sid || ""),
    accessToken: crypto.randomBytes(24).toString("base64url"),
  };
}

function verifyJobAccess(job, sessionClaims, accessToken) {
  if (!job || !sessionClaims || !sessionClaims.sid) return false;
  if (!safeEqual(job.ownerSessionId, sessionClaims.sid)) return false;
  return safeEqual(job.accessToken, accessToken);
}

module.exports = {
  WEB_SESSION_MAX_AGE_MS,
  createWebSession,
  verifyWebSession,
  requestTokenFor,
  verifyRequestToken,
  isAutomatedUserAgent,
  isSameOriginRequest,
  createJobAccess,
  verifyJobAccess,
  normalizeLandingAttribution,
  sanitizeReferrer,
  isLibinDesignHost,
};
