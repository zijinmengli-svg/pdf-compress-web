"use strict";
const path = require("path");

function makeCompressedDownloadName(name) {
  const base = path.basename(name || "compressed.pdf");
  const safe = base.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_") || "compressed.pdf";
  const parsed = path.parse(safe);
  return `${parsed.name}.tinypdf.cn${parsed.ext || ".pdf"}`;
}

module.exports = { makeCompressedDownloadName };
