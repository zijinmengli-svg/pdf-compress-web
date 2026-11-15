"use strict";
const { runPrepaidMigrations } = require("./database");
const { createPaddleClient } = require("./paddle-client");
const { createPrepaidRuntime } = require("./prepaid-runtime");

async function startPaymentRuntime({ config, pool, authService,
  migrate = runPrepaidMigrations, makePaddle = createPaddleClient, makeRuntime = createPrepaidRuntime,
  onError = () => {} }) {
  if (!config || !config.ready || !pool || !authService) return null;
  await migrate(pool);
  const runtime = makeRuntime({ pool, authService, config, paddle: makePaddle(config) });
  let busy = false;
  const reconcile = async () => {
    if (busy) return;
    busy = true;
    try {
      if (config.quotaLeaseMs) {
        try { await runtime.quota.recoverExpired(); }
        catch { onError("compression_quota_recovery_unavailable"); }
      }
      await runtime.worker.processPendingWebhooks();
    }
    catch { onError("payment_reconciliation_unavailable"); }
    finally { busy = false; }
  };
  await reconcile();
  const timer = setInterval(reconcile, 15000);
  timer.unref();
  runtime.stopReconciliation = () => clearInterval(timer);
  return runtime;
}
module.exports = { startPaymentRuntime };
