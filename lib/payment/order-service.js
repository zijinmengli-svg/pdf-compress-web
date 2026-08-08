"use strict";

const crypto = require("crypto");
const { withTransaction } = require("./database");
const { hashAnonymousIdentity, createOrderCapability, verifyOrderCapability } = require("./security");

const RESULT_RETENTION_MS = 60 * 60 * 1000;

function field(row, camel, snake) {
  return row && (row[camel] !== undefined ? row[camel] : row[snake]);
}

function createOrderService({ repo, pool, identityHashSecret, creditService = null, now = () => new Date(), transaction = withTransaction }) {
  if (!repo) throw new TypeError("repo is required");
  if (!String(identityHashSecret || "").trim()) throw new TypeError("identityHashSecret is required");

  async function appendLifecycleEvent(tx, input) {
    return repo.appendOrderEvent({
      orderId: input.orderId,
      eventType: input.eventType,
      source: "server",
      paymentStatus: input.paymentStatus,
      fulfillmentStatus: input.fulfillmentStatus,
      customerAmountMinor: 0,
      customerCurrency: input.currency,
      revenueDeltaMinor: 0,
      revenueCurrency: "USD",
      metadata: input.metadata || {},
      occurredAt: input.occurredAt,
    }, tx);
  }

  return {
    async registerCompressionSuccess(input) {
      if (!String(input && input.sessionId || "").trim()) throw new Error("signed website session is required");
      if (!String(input.jobId || "").trim()) throw new Error("compression job is required");
      if (!Number.isSafeInteger(input.resultBytes) || input.resultBytes <= 0) throw new Error("successful compression result is required");

      const timestamp = now();
      const orderId = crypto.randomUUID();
      const capability = createOrderCapability();
      const identityHash = hashAnonymousIdentity(input.sessionId, identityHashSecret);
      const expiresAt = new Date(timestamp.getTime() + RESULT_RETENTION_MS);

      return transaction(pool, async (tx) => {
        const settings = await repo.getSettings(tx);
        if (!settings) throw new Error("payment catalog is not configured");
        const useCny = String(input.country || "").toUpperCase() === "CN";
        const priceAmountMinor = Number(field(settings, useCny ? "cnyAmountMinor" : "usdAmountMinor", useCny ? "cny_amount_minor" : "usd_amount_minor"));
        const priceCurrency = useCny ? "CNY" : "USD";
        const paddlePriceId = field(settings, "paddlePriceId", "paddle_price_id");
        const paddleProductId = field(settings, "paddleProductId", "paddle_product_id");
        if (!Number.isSafeInteger(priceAmountMinor) || priceAmountMinor <= 0 || !paddlePriceId || !paddleProductId) {
          throw new Error("payment catalog is invalid");
        }

        await repo.createOrder({
          id: orderId,
          publicTokenHash: capability.tokenHash,
          jobId: input.jobId,
          anonymousIdentityHash: identityHash,
          paymentStatus: "unpaid",
          fulfillmentStatus: "compressed",
          paddleProductId,
          paddlePriceId,
          originalBytes: input.originalBytes,
          targetBytes: input.targetBytes,
          resultBytes: input.resultBytes,
          reachedTarget: Boolean(input.reachedTarget),
          language: input.language || "en",
          country: input.country || "",
          priceAmountMinor,
          priceCurrency,
          source: input.attribution && input.attribution.source || "Direct",
          sourceCategory: input.attribution && input.attribution.sourceCategory || "direct",
          sourceJson: input.attribution || {},
          compressedAt: timestamp,
          expiresAt,
        }, tx);

        let free;
        let creditSource = "legacy_free_grant";
        let remainingCredits = null;
        if (creditService && input.walletHash) {
          const credit = await creditService.consumeForCompression({ walletHash: input.walletHash, legacyIdentityHash: identityHash, jobId: input.jobId }, tx);
          if (credit.source !== "disabled") {
            free = Boolean(credit.granted);
            creditSource = credit.source || (free ? "ledger" : "none");
            remainingCredits = credit.remaining == null ? null : Number(credit.remaining);
          } else {
            free = await repo.consumeFreeGrant(identityHash, orderId, tx);
          }
        } else {
          free = await repo.consumeFreeGrant(identityHash, orderId, tx);
        }
        const paymentStatus = free ? "not_required" : "unpaid";
        const fulfillmentStatus = free ? "available" : "compressed";
        if (free) await repo.updateOrderState(orderId, { paymentStatus, fulfillmentStatus }, tx);

        await appendLifecycleEvent(tx, { orderId, eventType: "compression_succeeded", paymentStatus, fulfillmentStatus, currency: priceCurrency, occurredAt: timestamp });
        await appendLifecycleEvent(tx, { orderId, eventType: free ? (creditSource === "legacy_free_grant" ? "free_grant_consumed" : "credit_consumed") : "payment_required", paymentStatus, fulfillmentStatus, currency: priceCurrency, occurredAt: timestamp });

        return {
          orderId,
          capabilityToken: capability.token,
          paymentRequired: !free,
          expiresAt,
          price: { amountMinor: priceAmountMinor, currency: priceCurrency, paddlePriceId },
          creditSource,
          remainingCredits,
        };
      });
    },

    async getAuthorizedOrder({ orderId, capabilityToken, sessionClaims }) {
      if (!sessionClaims || !sessionClaims.sid) throw new Error("order is not authorized");
      const order = await repo.getOrder(orderId);
      if (!order) throw new Error("order is not authorized");
      const expectedIdentity = hashAnonymousIdentity(sessionClaims.sid, identityHashSecret);
      const identity = field(order, "anonymousIdentityHash", "anonymous_identity_hash");
      const tokenHash = field(order, "publicTokenHash", "public_token_hash");
      const expiresAt = new Date(field(order, "expiresAt", "expires_at"));
      if (identity !== expectedIdentity || !verifyOrderCapability(capabilityToken, tokenHash) || !Number.isFinite(expiresAt.getTime()) || expiresAt <= now()) {
        throw new Error("order is not authorized");
      }
      return order;
    },

    async authorizeFreeDownload({ jobId, sessionClaims, jobAccessToken, job }) {
      if (!job || !sessionClaims || !sessionClaims.sid) return false;
      return String(job.id || job.jobId || "") === String(jobId || "") &&
        String(job.ownerSessionId || "") === String(sessionClaims.sid) &&
        String(job.accessToken || "") === String(jobAccessToken || "");
    },

    async markDownloadUrlIssued(orderId) {
      return repo.updateOrderState(orderId, { downloadUrlIssuedAt: now() });
    },
  };
}

module.exports = { RESULT_RETENTION_MS, createOrderService };
