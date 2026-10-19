"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const publicDir = path.join(__dirname, "..", "public");
const en = fs.readFileSync(path.join(publicDir, "compress-portfolio-pdf.html"), "utf8");
const zh = fs.readFileSync(path.join(publicDir, "zh", "compress-portfolio-pdf.html"), "utf8");

for (const [locale, page] of [["en", en], ["zh-CN", zh]]) {
  assert.match(page, new RegExp(`<html lang="${locale}">`));
  assert.ok(page.indexOf('id="compress-form"') < page.indexOf('class="portfolio-guide"'), `${locale}: guide must follow the tool`);
  assert.ok(page.indexOf('class="portfolio-guide"') < page.indexOf('id="ad-slot-main"'), `${locale}: guide must precede ads`);
  assert.match(page, /<h2[^>]*>.*(?:portfolio|作品集)/i);
}

assert.match(en, /<span class="quota-preview"[^>]*>3 compressions left<\/span>/);
assert.match(en, /<span>Your PDF, Your size\.<\/span>/);
assert.match(en, /Compress a PDF to the exact file size you need\./);
assert.match(en, /href="\/zh\/compress-portfolio-pdf"/);
assert.match(zh, /<span class="quota-preview"[^>]*>剩余 3 次压缩<\/span>/);
assert.match(zh, /<span>你的 PDF，你定大小。<\/span>/);
assert.match(zh, /href="\/compress-portfolio-pdf"/);
assert.match(zh, /设计作品集/);
assert.doesNotMatch(zh, /Practical starting point|Quality note|Protect the pages reviewers/);

console.log("portfolio layout and language parity tests passed");
