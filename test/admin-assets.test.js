"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(__dirname, "..", "public", "admin.js"), "utf8");

assert.match(
  html,
  /<link rel="stylesheet" href="\.\/styles\.css"\s*\/>/,
  "admin.html must use a relative stylesheet path so its UI also renders when opened locally"
);

assert.doesNotMatch(
  adminJs,
  /const base = Math\.max\(entries\[0\].*?, 1\);/,
  "an empty visit base must not turn later funnel events into a percentage above 100%"
);

assert.match(
  html,
  /<script src="\.\/admin\.js\?v=[^"]+" defer><\/script>/,
  "admin.html must use a relative script path so its UI assets resolve consistently"
);

assert.match(html, /id="referrals-section"/, "admin page must expose referral rewards settings");
assert.match(html, /id="referral-daily-cap"/, "admin page must expose the daily referral cap");
assert.match(adminJs, /\/api\/admin\/referrals/, "admin script must load referral metrics");
assert.match(adminJs, /\/api\/admin\/referrals\/settings/, "admin script must save referral settings");

console.log("PASS - admin page uses portable relative asset paths");
