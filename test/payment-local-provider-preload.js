"use strict";
// Loaded explicitly by the isolated acceptance test; never by the production server.
const fs = require("node:fs");
const { createPaddleClient } = require("../lib/payment/paddle-client");
const startup = require("../lib/payment/startup");
const start = startup.startPaymentRuntime;
startup.startPaymentRuntime = async options => {
  const { config } = options;
  const database = new URL(config.databaseUrl);
  if (!config.quotaLeaseMs || config.environment !== "sandbox" || process.env.HOST !== "127.0.0.1" ||
      database.hostname !== "127.0.0.1" || database.pathname !== "/tinypdf_test_http" ||
      config.apiKey !== "pdl_sdbx_apikey_isolated" || config.clientToken !== "test_isolated" ||
      !process.env.TINYPDF_QA_PROVIDER_FILE) throw new Error("Local acceptance provider guard failed");
  return start({ ...options, config: { ...config, enabled: true }, makePaddle: () => {
    const { verifyWebhook } = createPaddleClient(config);
    const fixture = () => JSON.parse(fs.readFileSync(process.env.TINYPDF_QA_PROVIDER_FILE, "utf8"));
    return {
      verifyWebhook,
      getTransaction: async id => fixture().transactions?.[id],
      listRefundAdjustments: async id => fixture().adjustments?.[id] || [],
      requestFullRefund: async ({ transactionId }) => ({
        id: `adj_${transactionId}`, transactionId, action: "refund", type: "full", status: "pending_approval",
      }),
    };
  } });
};
