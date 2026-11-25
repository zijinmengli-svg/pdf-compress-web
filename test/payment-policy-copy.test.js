const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const page of ['pricing', 'refund', 'terms']) {
  test(`${page} matches the daily allowance and prepaid bundle contract in both languages`, () => {
    const html = fs.readFileSync(path.join(__dirname, '../public', `${page}.html`), 'utf8');
    assert.doesNotMatch(html, /first successful.*browser|浏览器首次|payment before download|paid result cannot be delivered|currently free|not yet accepting payments|planned one-time/i);
    for (const phrase of ['02:00', 'Asia/Shanghai', '1, 3, 5, or 10', '每日', '凌晨', '不累积', '1、3、5、10', '未使用', '部分使用']) {
      assert.ok(html.includes(phrase), `${page} missing ${phrase}`);
    }
    assert.match(html, /repeat downloads do not consume/i);
    assert.match(html, /successful compression/i);
    assert.match(html, /original payment method/i);
  });
}
