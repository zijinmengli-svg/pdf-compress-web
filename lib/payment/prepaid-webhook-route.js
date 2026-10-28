"use strict";

const MAX_WEBHOOK_BYTES = 256 * 1024;

async function readRawBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_WEBHOOK_BYTES) {
      const error = new Error("Paddle webhook body is too large");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function createPrepaidWebhookRoute({ getRuntime, json, sendError }) {
  if (typeof getRuntime !== "function" || typeof json !== "function" || typeof sendError !== "function") {
    throw new TypeError("Paddle webhook route dependencies are required");
  }
  return async function handle(req, res, url) {
    if (url.pathname !== "/api/paddle/webhook") return false;
    if (req.method !== "POST") { sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed"); return true; }
    const runtime = getRuntime();
    if (!runtime || !runtime.webhooks) { sendError(res, 503, "PAYMENT_UNAVAILABLE", "Payment service unavailable"); return true; }
    if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers["content-type"] || ""))) {
      sendError(res, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON is required"); return true;
    }
    const signature = req.headers["paddle-signature"];
    if (typeof signature !== "string" || !signature) {
      sendError(res, 401, "INVALID_SIGNATURE", "Invalid Paddle signature"); return true;
    }
    try {
      const rawBody = await readRawBody(req);
      await runtime.webhooks.acceptWebhook({ rawBody, signature });
      json(res, 200, { received: true });
    } catch (error) {
      if (error && error.code === "BODY_TOO_LARGE") sendError(res, 413, "WEBHOOK_TOO_LARGE", "Webhook is too large");
      else if (/signature|invalid webhook/i.test(String(error && error.message || ""))) sendError(res, 401, "INVALID_SIGNATURE", "Invalid Paddle signature");
      else sendError(res, 503, "WEBHOOK_UNAVAILABLE", "Webhook could not be received");
    }
    return true;
  };
}

module.exports = { createPrepaidWebhookRoute, MAX_WEBHOOK_BYTES };
