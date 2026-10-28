"use strict";

const { resolveAccountWallet } = require("./account-wallet");
const { createPrepaidLedger } = require("./prepaid-ledger");
const { createCreditPurchaseService } = require("./credit-purchase");
const { createPrepaidWebhookRepository } = require("./prepaid-webhook-repository");
const { createWebhookService } = require("./webhook-service");
const { createPrepaidWebhookWorker } = require("./prepaid-webhook-worker");

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
  const worker = createPrepaidWebhookWorker({ repo, pool, paddle, creditPurchases: purchases, now });

  return {
    enabled: Boolean(config.enabled && config.ready), authService, purchases, ledger, webhooks, worker,
    resolveWallet({ sessionToken, guestWalletHash }) {
      return resolveAccountWallet({ pool, authService, sessionToken, guestWalletHash, secret: config.identityHashSecret });
    },
  };
}

module.exports = { createPrepaidRuntime };
