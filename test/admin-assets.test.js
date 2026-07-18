"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "admin.html"), "utf8");

assert.match(
  html,
  /<link rel="stylesheet" href="\.\/styles\.css"\s*\/>/,
  "admin.html must use a relative stylesheet path so its UI also renders when opened locally"
);

assert.match(
  html,
  /<script src="\.\/admin\.js\?v=[^"]+" defer><\/script>/,
  "admin.html must use a relative script path so its UI assets resolve consistently"
);

console.log("PASS - admin page uses portable relative asset paths");
