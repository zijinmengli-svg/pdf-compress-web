"use strict";
const assert = require("assert");
const { makeCompressedDownloadName } = require("../lib/download-name");

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS - " + name);
    passed++;
  } catch (e) {
    console.log("FAIL - " + name + " :: " + e.message);
    failed++;
  }
}

test("adds tinypdf.cn before the .pdf extension", () => {
  assert.strictEqual(makeCompressedDownloadName("portfolio.pdf"), "portfolio.tinypdf.cn.pdf");
  assert.strictEqual(makeCompressedDownloadName("sales-deck.final.pdf"), "sales-deck.final.tinypdf.cn.pdf");
});

test("keeps a pdf extension when the upload name has no extension", () => {
  assert.strictEqual(makeCompressedDownloadName("portfolio"), "portfolio.tinypdf.cn.pdf");
  assert.strictEqual(makeCompressedDownloadName(""), "compressed.tinypdf.cn.pdf");
});

console.log(`\nSUMMARY: ${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
