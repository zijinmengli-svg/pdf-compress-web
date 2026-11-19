"use strict";
// Temporary allowlist for the isolated hosted acceptance environment, not a production release switch.
function allowHostedSandbox(config, env) {
  let database;
  try { database = new URL(config.databaseUrl); } catch { return false; }
  return Boolean(config.ready && config.enabled && config.environment === "sandbox" &&
    config.apiKey?.startsWith("pdl_sdbx_apikey_") && config.clientToken?.startsWith("test_") &&
    config.notificationSettingId === "ntfset_01m7qqj9xfr52h0x79877v9g6z" &&
    env.TINYPDF_HOSTED_SANDBOX_TEST === "true" &&
    env.RENDER_SERVICE_ID === "srv-dbssv7tg1s2s73845m7g" &&
    env.RENDER_EXTERNAL_URL === "https://tinypdf-payment-qa.onrender.com" &&
    /^dpg-dbsstge1egvs73epdj2g-a(?:\.oregon-postgres\.render\.com)?$/.test(database.hostname));
}
module.exports = { allowHostedSandbox };
