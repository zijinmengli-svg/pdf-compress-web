"use strict";

const { SESSION_MS } = require("./service");

const COOKIE = "tinypdf_account";

function sessionCookie(req, token, maxAge = Math.floor(SESSION_MS / 1000)) {
  const host = String(req.headers.host || "");
  const secure = /(^|\.)tinypdf\.cn(?::\d+)?$/i.test(host) || req.headers["x-forwarded-proto"] === "https";
  return `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function createEmailAuthRoutes({ getService, website, readJson, json, sendError, parseCookies }) {
  if (typeof getService !== "function") throw new TypeError("Auth service provider is required");
  return async function handle(req, res, url) {
    const pathname = url.pathname;
    if (!["/api/auth/me", "/api/auth/request-code", "/api/auth/verify", "/api/auth/logout"].includes(pathname)) return false;
    const service = getService();
    if (pathname === "/api/auth/me" && req.method === "GET") {
      if (!service) { json(res, 200, { available: false, authenticated: false }); return true; }
      try {
        const session = await service.getSession(parseCookies(req)[COOKIE]);
        json(res, 200, session ? { available: true, authenticated: true, ...session.account } : { available: true, authenticated: false });
      } catch { sendError(res, 503, "AUTH_UNAVAILABLE", "Email login is temporarily unavailable"); }
      return true;
    }
    if (req.method !== "POST") { sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed"); return true; }
    if (!website(req, true)) { sendError(res, 403, "WEBSITE_SESSION_REQUIRED", "Refresh TinyPDF and try again"); return true; }
    if (!service) { sendError(res, 503, "AUTH_UNAVAILABLE", "Email login is not configured"); return true; }
    if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers["content-type"] || ""))) {
      sendError(res, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON is required"); return true;
    }
    let body;
    try { body = await readJson(req, 2048); }
    catch { sendError(res, 400, "BAD_REQUEST", "Invalid JSON payload"); return true; }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      sendError(res, 400, "BAD_REQUEST", "Invalid JSON payload"); return true;
    }
    try {
      if (pathname === "/api/auth/request-code") {
        await service.requestCode({ email: body.email, ip: req.socket?.remoteAddress || "unknown" });
        json(res, 200, { sent: true });
      } else if (pathname === "/api/auth/verify") {
        const result = await service.verifyCode({ email: body.email, code: body.code });
        json(res, 200, { authenticated: true, account: result.account }, { "Set-Cookie": sessionCookie(req, result.token) });
      } else {
        await service.logout(parseCookies(req)[COOKIE]);
        json(res, 200, { authenticated: false }, { "Set-Cookie": sessionCookie(req, "", 0) });
      }
    } catch (error) {
      const message = String(error.message || "");
      if (/wait/i.test(message)) sendError(res, 429, "RATE_LIMITED", "Please wait before requesting another code");
      else if (/Invalid or expired verification code/i.test(message)) sendError(res, 400, "INVALID_CODE", "Invalid or expired verification code");
      else if (/Invalid email address/i.test(message)) sendError(res, 400, "INVALID_EMAIL", "Invalid email address");
      else if (/could not be sent/i.test(message)) sendError(res, 503, "EMAIL_DELIVERY_FAILED", "Verification email could not be sent");
      else sendError(res, 503, "AUTH_UNAVAILABLE", "Email login is temporarily unavailable");
    }
    return true;
  };
}

module.exports = { createEmailAuthRoutes, sessionCookie };
