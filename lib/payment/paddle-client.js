"use strict";

const { Paddle, Environment, LogLevel } = require("@paddle/paddle-node-sdk");

function paddleMinor(value, field) {
  if (!/^-?\d+$/.test(String(value))) throw new Error(`Invalid Paddle ${field}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Unsafe Paddle ${field}`);
  return parsed;
}

function totals(source, prefix) {
  const value = source || {};
  return {
    [`${prefix}SubtotalMinor`]: paddleMinor(value.subtotal || "0", `${prefix}.subtotal`),
    [`${prefix}TaxMinor`]: paddleMinor(value.tax || "0", `${prefix}.tax`),
    [`${prefix}FeeMinor`]: paddleMinor(value.fee || "0", `${prefix}.fee`),
    [`${prefix}EarningsMinor`]: paddleMinor(value.earnings || "0", `${prefix}.earnings`),
    [`${prefix}Currency`]: String(value.currencyCode || "").toUpperCase(),
  };
}

function createPaddleAdapter(config, deps = {}) {
  const apiKey = config && (config.apiKey || config.paddleApiKey);
  if (!String(apiKey || "").trim()) throw new TypeError("Paddle API key is required");
  if (!String(config.webhookSecret || "").trim()) throw new TypeError("Paddle webhook secret is required");
  const paddle = deps.paddle || new (deps.Paddle || Paddle)(apiKey, {
    environment: config.environment === "sandbox" ? (deps.Environment || Environment).sandbox : (deps.Environment || Environment).production,
    ...(LogLevel && (deps.LogLevel || LogLevel) ? { logLevel: (deps.LogLevel || LogLevel).error } : {}),
  });

  return {
    async createCheckoutTransaction({ orderId, attemptKey, priceId }) {
      const transaction = await paddle.transactions.create({
        items: [{ priceId, quantity: 1 }],
        collectionMode: "automatic",
        customData: { tinypdfOrderId: orderId, tinypdfAttemptKey: attemptKey },
      });
      return { transactionId: transaction.id, checkoutUrl: transaction.checkout && transaction.checkout.url || "", status: transaction.status };
    },
    async verifyWebhook(rawBody, signature) {
      if (typeof rawBody !== "string" || !signature) throw new Error("Paddle webhook signature is required");
      return paddle.webhooks.unmarshal(rawBody, config.webhookSecret, signature);
    },
    getTransaction(transactionId) { return paddle.transactions.get(transactionId); },
    cancelTransaction(transactionId) { return paddle.transactions.update(transactionId, { status: "canceled" }); },
    async createPriceVersion({ productId, previousPriceId, usdAmountMinor, cnyAmountMinor }) {
      const previous = await paddle.prices.get(previousPriceId);
      if (previous.productId !== productId) throw new Error("previous Paddle price does not belong to configured product");
      const overrides = (previous.unitPriceOverrides || []).filter((override) => !((override.countryCodes || []).some((country) => String(country).toUpperCase() === "CN")));
      overrides.push({ countryCodes: ["CN"], unitPrice: { amount: String(paddleMinor(cnyAmountMinor, "cnyAmountMinor")), currencyCode: "CNY" } });
      const price = await paddle.prices.create({
        productId,
        name: previous.name || "TinyPDF compressed result",
        description: previous.description || "One paid TinyPDF result",
        billingCycle: null,
        trialPeriod: null,
        taxMode: previous.taxMode || "location",
        unitPrice: { amount: String(paddleMinor(usdAmountMinor, "usdAmountMinor")), currencyCode: "USD" },
        unitPriceOverrides: overrides,
      });
      if (!/^pri_/.test(String(price.id || "")) || price.billingCycle !== null) throw new Error("Paddle did not create a one-time price version");
      return price;
    },
    async findTransactionForAttempt({ orderId, attemptKey, createdAfter }) {
      const collection = paddle.transactions.list({ perPage: 30, orderBy: "-created_at" });
      const transactions = typeof collection.next === "function" ? await collection.next() : [];
      const after = createdAfter ? new Date(createdAfter).getTime() : 0;
      return transactions.find((transaction) => {
        const customData = transaction.customData || {};
        const createdAt = new Date(transaction.createdAt || 0).getTime();
        return createdAt >= after && customData.tinypdfOrderId === orderId && customData.tinypdfAttemptKey === attemptKey;
      }) || null;
    },
    requestFullRefund({ transactionId, reason = "service_not_delivered" }) { return paddle.adjustments.create({ action: "refund", transactionId, reason, type: "full" }); },
    normalizeCompletedTransaction(transaction) {
      const customer = transaction.details && transaction.details.totals || {};
      const payout = transaction.payoutTotals || {};
      const adjusted = transaction.adjustedPayoutTotals || payout;
      return {
        transactionCurrency: String(customer.currencyCode || "").toUpperCase(),
        customerSubtotalMinor: paddleMinor(customer.subtotal || "0", "details.totals.subtotal"),
        customerDiscountMinor: paddleMinor(customer.discount || "0", "details.totals.discount"),
        customerTaxMinor: paddleMinor(customer.tax || "0", "details.totals.tax"),
        customerTotalMinor: paddleMinor(customer.total || "0", "details.totals.total"),
        paddleFeeMinor: paddleMinor(customer.fee || payout.fee || "0", "details.totals.fee"),
        transactionEarningsMinor: paddleMinor(customer.earnings || "0", "details.totals.earnings"),
        ...totals(payout, "payout"),
        payoutExchangeRate: String(payout.exchangeRate || "1"),
        ...totals(adjusted, "adjustedPayout"),
        adjustedPayoutEarningsMinor: paddleMinor(adjusted.earnings || "0", "adjustedPayoutTotals.earnings"),
        payoutCurrencyIsUsd: String(payout.currencyCode || "").toUpperCase() === "USD",
      };
    },
    normalizeAdjustment(adjustment) {
      const payout = adjustment.payoutTotals || {};
      return {
        transactionId: adjustment.transactionId,
        payoutCurrency: String(payout.currencyCode || adjustment.currencyCode || "").toUpperCase(),
        revenueDeltaMinor: paddleMinor(payout.earnings || "0", "adjustment.payoutTotals.earnings"),
        feeMinor: paddleMinor(payout.fee || "0", "adjustment.payoutTotals.fee"),
        customerTotalMinor: paddleMinor(adjustment.totals && adjustment.totals.total || "0", "adjustment.totals.total"),
        customerCurrency: String(adjustment.currencyCode || "").toUpperCase(),
      };
    },
  };
}

module.exports = { createPaddleAdapter, paddleMinor };
