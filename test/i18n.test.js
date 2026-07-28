"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createTranslator } = require("../public/i18n.js");

const zh = createTranslator("zh-CN");
const en = createTranslator("en");
const fallback = createTranslator("fr-FR");

assert.strictEqual(zh.language, "zh-CN");
assert.strictEqual(en.language, "en");
assert.strictEqual(fallback.language, "en");

assert.strictEqual(zh.text("compressButton"), "开始压缩");
assert.strictEqual(en.text("compressButton"), "Compress PDF");
assert.strictEqual(zh.text("websiteSessionRequired"), "请刷新 TinyPDF 页面后重试。");
assert.strictEqual(en.text("websiteSessionRequired"), "Please refresh TinyPDF and try again.");
assert.strictEqual(
  zh.text("uploadLimit", { max: 100 }),
  "免费使用 · 无需注册 · 单个文件最高 100MB"
);
assert.strictEqual(
  en.text("uploadLimit", { max: 100 }),
  "Free · No account required · One file up to 100MB"
);
assert.strictEqual(zh.text("unknownKey"), "unknownKey");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app-simple.js"), "utf8");
assert.match(appSource, /TinyPDFI18n\.createTranslator\(document\.documentElement\.lang\)/);
assert.match(appSource, /landingLanguage:\s*i18n\.language/);
assert.match(appSource, /trackEvent\("target_entered"/);
assert.match(appSource, /X-TinyPDF-Web-Token/);
assert.match(appSource, /webRequestToken/);
assert.match(appSource, /accessToken/);
assert.match(appSource, /events\?access=/);
assert.match(appSource, /download\?access=/);
assert.doesNotMatch(appSource, /submitButton\.textContent = "Compress PDF"/);

console.log("PASS - runtime translations support Chinese, English, interpolation, and fallback");
