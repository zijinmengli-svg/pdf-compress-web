"use strict";

const { resolveAccountWallet } = require("./account-wallet");
const { createPrepaidLedger } = require("./prepaid-ledger");
const { createCreditPurchaseService } = require("./credit-purchase");
const { createPrepaidWebhookRepository } = require("./prepaid-webhook-repository");
const { createWebhookService } = require("./webhook-service");
const { createPrepaidWebhookWorker } = require("./prepaid-webhook-worker");
const { createCatalog } = require("./catalog");
const { createOrderService } = require("./order-service");
const { createTinyPdfAdapter } = require("./tinypdf-adapter");
const { createCompressionQuota } = require("./compression-quota");

function createPrepaidRuntime({ pool, authService, config, paddle, now }) {
  if (!pool || !authService || !config || !paddle || !config.identityHashSecret || !config.webSessionSecret) {
    throw new TypeError("prepaid runtime dependencies are required");
  }
  const ledger = createPrepaidLedger({ pool, now });
  const repo = createPrepaidWebhookRepository({ now });
  const purchases = createCreditPurchaseService({
    pool, referralRepo: ledger, intentSecret: config.webSessionSecret, now,
    getSettings: () => ({ paddle_price_id: config.priceId, paddle_product_id: config.productId }),
  });
  const webhooks = createWebhookService({ repo, pool, paddle });
  // Legacy callers without an environment retain history support only.
  const orders = config.environment ? createOrderService({ pool, paddle, now, intentSecret: config.webSessionSecret,
    catalog: createCatalog({ environment: config.environment, products: [{ key: "tinypdf", enabled: true,
      offers: [{ key: "compression-credit", enabled: true, quantities: [1, 3, 5, 10], unitsPerQuantity: 1,
        paddle: { [config.environment]: { productId: config.productId, priceId: config.priceId } } }] }] }),
    adapters: new Map([["tinypdf", createTinyPdfAdapter({ pool, authService, ledger, identityHashSecret: config.identityHashSecret })]]),
  }) : null;
  const worker = createPrepaidWebhookWorker({ repo, pool, paddle, creditPurchases: purchases, orderService: orders, now });

  return {
    enabled: Boolean(config.enabled && config.ready), authService, purchases, orders, ledger, webhooks, worker,
    checkout: config.ready && config.enabled && config.clientToken
      ? { environment: config.environment, clientToken: config.clientToken } : null,
    referenceUnitMinor: { USD: config.usdAmountMinor, CNY: config.cnyAmountMinor },
    quota: createCompressionQuota({ pool, ledger, leaseMs: config.quotaLeaseMs }),
    resolveWallet({ sessionToken, guestWalletHash }) {
      return resolveAccountWallet({ pool, authService, sessionToken, guestWalletHash, secret: config.identityHashSecret });
    },
  };
}

module.exports = { createPrepaidRuntime };
