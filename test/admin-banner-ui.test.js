const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../public/admin-banner.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../public/admin-banner.js'), 'utf8');

assert.match(css, /#banner-save\s*\{[^}]*background:[^}]*color:/s, 'save button needs a visible background and text color');
assert.match(css, /#banner-reload\s*\{[^}]*background:[^}]*color:/s, 'reload button needs a visible background and text color');
assert.match(js, /检测到[^`]*\$\{img\.naturalWidth\}[^`]*\$\{img\.naturalHeight\}/, 'dimension error should report the actual detected size');
assert.doesNotMatch(js, /catch\(e\)[\s\S]{0,160}banner-file'\)\.value=''/, 'an invalid selection should keep its filename visible');
console.log('admin banner upload feedback and button contrast tests passed');
