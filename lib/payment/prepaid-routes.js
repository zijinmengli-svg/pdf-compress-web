"use strict";

const COOKIE = "tinypdf_account";
const QUANTITIES = new Set([1, 3, 5, 10]);

function createPrepaidRoutes({ getRuntime, resolveWallet, website, parseCookies, readJson, json, sendError }) {
  if (typeof getRuntime !== "function" || typeof resolveWallet !== "function") throw new TypeError("prepaid route dependencies are required");
  return async function handle(req, res, url) {
    const endpoint = url.pathname;
    if (!["/api/credits/purchase-intent", "/api/credits/purchase-status", "/api/credits/purchases"].includes(endpoint)) return false;
    const isIntent = endpoint === "/api/credits/purchase-intent";
    if (req.method !== (isIntent ? "POST" : "GET")) { sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed"); return true; }
    if (!website(req, isIntent)) { sendError(res, 403, "WEBSITE_SESSION_REQUIRED", "Refresh TinyPDF and try again"); return true; }
    const runtime = getRuntime();
    if (!runtime || !runtime.authService || !runtime.purchases || isIntent && !runtime.enabled) {
      sendError(res, 503, "PAYMENT_UNAVAILABLE", "Purchases are temporarily unavailable"); return true;
    }
    const sessionToken = parseCookies(req)[COOKIE];
    let session;
    try { session = await runtime.authService.getSession(sessionToken); }
    catch { sendError(res, 503, "AUTH_UNAVAILABLE", "Account is temporarily unavailable"); return true; }
    if (!session || !session.account) { sendError(res, 401, "LOGIN_REQUIRED", "Email login is required"); return true; }
    try {
      const wallet = await resolveWallet(req, sessionToken);
      if (!wallet || wallet.accountId !== session.account.id || !wallet.walletHash) throw new Error("Account wallet binding mismatch");
      if (isIntent) {
        if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers["content-type"] || ""))) {
          sendError(res, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON is required"); return true;
        }
        let body;
        try { body = await readJson(req, 2048); }
        catch { sendError(res, 400, "BAD_REQUEST", "Invalid JSON payload"); return true; }
        if (!body || typeof body !== "object" || Array.isArray(body) || !QUANTITIES.has(body.quantity)) {
          sendError(res, 400, "INVALID_QUANTITY", "Choose 1, 3, 5, or 10 compression credits"); return true;
        }
        json(res, 200, runtime.purchases.createIntent({ accountId: session.account.id, walletHash: wallet.walletHash, quantity: body.quantity }));
      } else if (endpoint === "/api/credits/purchase-status") {
        const transactionId = url.searchParams.get("transactionId") || "";
        if (!/^txn_[A-Za-z0-9_]+$/.test(transactionId)) { sendError(res, 400, "INVALID_TRANSACTION", "Invalid transaction ID"); return true; }
        json(res, 200, await runtime.purchases.getPurchaseStatus({ walletHash: wallet.walletHash, transactionId }));
      } else {
        json(res, 200, { purchases: await runtime.purchases.listAccountPurchases({ accountId: session.account.id, walletHash: wallet.walletHash }) });
      }
    } catch {
      sendError(res, 503, "PAYMENT_UNAVAILABLE", "Purchases are temporarily unavailable");
    }
    return true;
  };
}

module.exports = { createPrepaidRoutes };
