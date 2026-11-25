const { test } = require('node:test');
const assert = require('node:assert/strict');
const { allowProduction } = require('../lib/payment/production-gate');
const config = { ready: true, enabled: true, environment: 'production', apiKey: 'pdl_live_apikey_fixture', clientToken: 'live_fixture', operatorLegalName: 'Fixture Operator', databaseUrl: 'postgresql://fixture:fake@dpg-production-fixture/billing', productId: 'pro_'+'a'.repeat(26), priceId: 'pri_'+'b'.repeat(26), notificationSettingId: 'ntfset_'+'c'.repeat(26) };
const env = { TINYPDF_LIVE_PAYMENTS_RELEASE: 'true', RENDER_SERVICE_ID: 'srv-d9o4t88ae00c73anka80', RENDER_EXTERNAL_URL: 'https://tinypdf-free.onrender.com', TINYPDF_PAYMENT_RELEASE_BINDING: JSON.stringify({ databaseHost: 'dpg-production-fixture', databaseName: 'billing', productId: config.productId, priceId: config.priceId, notificationSettingId: config.notificationSettingId }) };
test('production purchase gate is closed by default and only permits exact explicit bindings', () => {
  assert.equal(allowProduction(config, {}), false);
  assert.equal(allowProduction(config, env), true);
  for (const update of [{ ready: false }, { enabled: false }, { environment: 'sandbox' }, { apiKey: 'pdl_sdbx_apikey_fixture' }, { clientToken: 'test_fixture' }, { operatorLegalName: '' }, { productId: 'pro_wrong' }, { priceId: 'pri_wrong' }, { notificationSettingId: 'ntfset_wrong' }, { databaseUrl: 'postgresql://fixture:fake@127.0.0.1/billing' }, { databaseUrl: 'postgresql://fixture:fake@dpg-production-fixture/other' }]) assert.equal(allowProduction({ ...config, ...update }, env), false);
  for (const update of [{ TINYPDF_LIVE_PAYMENTS_RELEASE: '' }, { TINYPDF_PAYMENT_RELEASE_BINDING: '{}' }, { TINYPDF_PAYMENT_RELEASE_BINDING: 'invalid' }, { RENDER_SERVICE_ID: 'srv-dbssv7tg1s2s73845m7g' }, { RENDER_EXTERNAL_URL: 'https://tinypdf-payment-qa.onrender.com' }, { TINYPDF_HOSTED_SANDBOX_TEST: 'true' }, { TINYPDF_LOCAL_QUOTA_TEST: 'true' }]) assert.equal(allowProduction(config, { ...env, ...update }), false);
});
test('production binding cannot approve the known QA database', () => {
  const binding = JSON.parse(env.TINYPDF_PAYMENT_RELEASE_BINDING);
  binding.databaseHost = 'dpg-dbsstge1egvs73epdj2g-a';
  assert.equal(allowProduction({ ...config, databaseUrl: 'postgresql://fixture:fake@'+binding.databaseHost+'/billing' }, { ...env, TINYPDF_PAYMENT_RELEASE_BINDING: JSON.stringify(binding) }), false);
});
test('rebinding known sandbox catalog IDs does not approve production', () => {
  for (const [key, value] of Object.entries({ productId: 'pro_01kyxwdy7d06mwq5357f30a0n8', priceId: 'pri_01kyxwwt8ewrsnsgcvbkddthh2', notificationSettingId: 'ntfset_01m7qqj9xfr52h0x79877v9g6z' })) {
    const binding = { ...JSON.parse(env.TINYPDF_PAYMENT_RELEASE_BINDING), [key]: value };
    assert.equal(allowProduction({ ...config, [key]: value }, { ...env, TINYPDF_PAYMENT_RELEASE_BINDING: JSON.stringify(binding) }), false);
  }
});
