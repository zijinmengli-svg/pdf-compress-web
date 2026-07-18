"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let setupAdminNavigation;
try {
  ({ setupAdminNavigation } = require(path.join(__dirname, "..", "public", "admin-navigation.js")));
} catch {
  setupAdminNavigation = null;
}

assert.strictEqual(
  typeof setupAdminNavigation,
  "function",
  "admin navigation must expose setupAdminNavigation"
);

const html = fs.readFileSync(path.join(__dirname, "..", "public", "admin.html"), "utf8");
assert.match(
  html,
  /<script src="\.\/admin-navigation\.js\?v=[^"]+" defer><\/script>/,
  "admin.html must load the navigation behavior"
);

function makeLink(href) {
  const classes = new Set();
  const listeners = {};
  return {
    classList: {
      add: value => classes.add(value),
      remove: value => classes.delete(value),
      contains: value => classes.has(value),
    },
    getAttribute: name => name === "href" ? href : null,
    addEventListener: (name, handler) => { listeners[name] = handler; },
    trigger: name => listeners[name] && listeners[name](),
  };
}

const links = [
  makeLink("#overview-section"),
  makeLink("#traffic-section"),
  makeLink("#files-section"),
  makeLink("#promotion-section"),
];

const positions = {
  "overview-section": 0,
  "traffic-section": 600,
  "files-section": 1200,
  "promotion-section": 1800,
};
const sections = Object.keys(positions).reduce((result, id) => {
  result[id] = { id, getBoundingClientRect: () => ({ top: positions[id] }) };
  return result;
}, {});
const windowListeners = {};
const documentRef = {
  querySelectorAll: selector => selector === ".admin-nav a" ? links : [],
  getElementById: id => sections[id] || null,
};
const windowRef = {
  location: { hash: "" },
  addEventListener: (name, handler) => { windowListeners[name] = handler; },
};

setupAdminNavigation(documentRef, windowRef);
assert.strictEqual(links[0].classList.contains("is-active"), true, "overview is active initially");

links[1].trigger("click");
assert.strictEqual(links[1].classList.contains("is-active"), true, "clicked navigation becomes active");
assert.strictEqual(links[0].classList.contains("is-active"), false, "previous navigation becomes inactive");

positions["overview-section"] = -1400;
positions["traffic-section"] = -800;
positions["files-section"] = 80;
positions["promotion-section"] = 700;
windowListeners.scroll();
assert.strictEqual(links[2].classList.contains("is-active"), true, "scroll position updates active navigation");

console.log("PASS - admin navigation follows clicks and scroll position");
