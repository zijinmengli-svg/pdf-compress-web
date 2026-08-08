"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "../public");
const english = fs.readFileSync(path.join(root, "index.html"), "utf8");
const chinese = fs.readFileSync(path.join(root, "zh/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app-simple.js"), "utf8");
const i18n = fs.readFileSync(path.join(root, "i18n.js"), "utf8");

for (const html of [english, chinese]) {
  assert.match(html, /id="referral-panel"/);
  assert.match(html, /id="copy-referral-link"/);
  assert.match(html, /id="share-referral-link"/);
  assert.match(html, /id="referral-balance"/);
}
assert.match(app, /\/api\/referral\/status/);
assert.match(app, /referral_link_copied/);
assert.match(app, /referral_share_clicked/);
assert.match(app, /navigator\.share/);
assert.match(app, /setTimeout\(refreshReferralStatus, 500\)/);
assert.match(i18n, /referralCopy/);
assert.match(i18n, /referralCopied/);
console.log("referral frontend tests passed");
