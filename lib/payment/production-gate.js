"use strict";
// Binding is an operator-reviewed deployment manifest, not proof of Paddle approval.
// No credentials or binding contents are logged. Default remains closed.
function allowProduction(config, env) {
  if (!config?.ready || !config.enabled || config.environment !== 'production' ||
      !config.apiKey?.startsWith('pdl_live_apikey_') || !config.clientToken?.startsWith('live_') ||
      !config.operatorLegalName?.trim() || env.TINYPDF_LIVE_PAYMENTS_RELEASE !== 'true' ||
      env.TINYPDF_HOSTED_SANDBOX_TEST === 'true' || env.TINYPDF_LOCAL_QUOTA_TEST === 'true' ||
      env.RENDER_SERVICE_ID !== 'srv-d9o4t88ae00c73anka80' ||
      env.RENDER_EXTERNAL_URL !== 'https://tinypdf-free.onrender.com') return false;
  try {
    const binding = JSON.parse(env.TINYPDF_PAYMENT_RELEASE_BINDING);
    const database = new URL(config.databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
        !/^dpg-[a-z0-9-]+(?:\.[a-z0-9.-]+)?$/.test(database.hostname) ||
        database.hostname.startsWith('dpg-dbsstge1egvs73epdj2g-a') ||
        database.hostname !== binding.databaseHost ||
        decodeURIComponent(database.pathname.slice(1)) !== binding.databaseName || !binding.databaseName) return false;
    return ['productId', 'priceId', 'notificationSettingId'].every((key, index) =>
      new RegExp('^' + ['pro_', 'pri_', 'ntfset_'][index] + '[a-z0-9]{26}$').test(config[key]) &&
      config[key] === binding[key]) &&
      config.productId !== 'pro_01kyxwdy7d06mwq5357f30a0n8' &&
      config.priceId !== 'pri_01kyxwwt8ewrsnsgcvbkddthh2' &&
      config.notificationSettingId !== 'ntfset_01m7qqj9xfr52h0x79877v9g6z';
  } catch { return false; }
}
module.exports = { allowProduction };
