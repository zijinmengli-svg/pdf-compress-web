"use strict";
const NO_STORE = { "Cache-Control": "no-store" };
const REFUND_REASONS = new Set(["duplicate", "service_not_delivered", "other"]);
function readDate(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid date");
  const instant = new Date(`${value}T00:00:00+08:00`);
  if (!Number.isFinite(instant.getTime()) || new Date(instant.getTime() + 28_800_000).toISOString().slice(0, 10) !== value) throw new Error("Invalid date");
  return instant;
}
function createPaymentAdminRoutes({ getRuntime, isAdmin, sameOrigin, allowRefunds, readJson, json, sendError }) {
  return async (req, res, url) => {
    const refund = url.pathname === "/api/admin/payments/refund";
    if (!refund && url.pathname !== "/api/admin/payments") return false;
    if (!isAdmin(req)) { sendError(res, 401, "UNAUTHORIZED", "Admin login required", NO_STORE); return true; }
    if (req.method !== (refund ? "POST" : "GET")) { sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed", NO_STORE); return true; }
    if (refund && !sameOrigin(req)) { sendError(res, 403, "ORIGIN_REQUIRED", "Open the admin page to request a refund", NO_STORE); return true; }
    const runtime = getRuntime();
    const enabled = Boolean(runtime?.orders && allowRefunds(runtime));
    if (!runtime?.orders || (refund && !enabled)) {
      sendError(res, 503, "PAYMENT_ADMIN_UNAVAILABLE", "Payment operation is not enabled", NO_STORE);
      return true;
    }
    if (refund) {
      let body;
      try {
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers?.["content-type"] || "")) throw new Error("Invalid content type");
        body = await readJson(req, 2048);
        if (!/^ord_[a-f0-9]{32}$/.test(body?.orderId || "") || !REFUND_REASONS.has(body?.reason) || body?.confirm !== true) throw new Error("Invalid refund input");
      } catch {
        sendError(res, 400, "INVALID_REFUND", "Order number, reason and confirmation are required", NO_STORE);
        return true;
      }
      try {
        const result = await runtime.orders.requestRefund({ orderId: body.orderId, reason: body.reason, adminActor: "site-admin", productKey: "tinypdf" });
        json(res, 202, result, NO_STORE);
      } catch {
        sendError(res, 409, "REFUND_NOT_CONFIRMED", "Refund not confirmed. Check the order before trying again.", NO_STORE);
      }
      return true;
    }
    let query, from, to;
    try {
      query = (url.searchParams.get("q") || "").trim().toLowerCase();
      if (query.length > 254) throw new Error("Search too long");
      from = readDate(url.searchParams.get("from"));
      const last = readDate(url.searchParams.get("to"));
      if (from && last && from > last) throw new Error("Invalid date range");
      to = last ? new Date(last.getTime() + 86_400_000) : null;
    } catch {
      sendError(res, 400, "INVALID_FILTER", "Invalid payment filter", NO_STORE);
      return true;
    }
    try {
      const orders = await runtime.orders.listAdminOrders({ productKey: "tinypdf", query, from, to });
      json(res, 200, { orders, refundsEnabled: enabled }, NO_STORE);
    } catch { sendError(res, 503, "PAYMENT_ADMIN_UNAVAILABLE", "Payment orders are unavailable", NO_STORE); }
    return true;
  };
}
module.exports = { createPaymentAdminRoutes };
