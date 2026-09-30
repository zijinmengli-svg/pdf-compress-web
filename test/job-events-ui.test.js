"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function element() {
  return {
    hidden: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
    value: "",
    files: [],
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    dispatchEvent() {},
  };
}

class FakeEventSource {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.closed = false;
    FakeEventSource.instances.push(this);
  }
  close() { this.closed = true; }
  emit(state) {
    if (!this.closed) this.onmessage({ data: JSON.stringify(state) });
  }
}

async function run() {
  const nodes = new Map();
  const getNode = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  getNode("pdf").files = [{ name: "example.pdf", size: 11 * 1024 * 1024 }];
  const document = {
    documentElement: { lang: "en" },
    referrer: "",
    title: "TinyPDF",
    getElementById: getNode,
    querySelector: () => element(),
    addEventListener() {},
  };
  const window = {
    location: { href: "http://localhost/", search: "" },
    TinyPDFI18n: { createTranslator: () => ({ language: "en", text: key => key }) },
    TinyPDFWebRequest: {
      postCompressionWithSession: async () => ({
        response: { ok: true },
        payload: { id: "job-1", accessToken: "access-1", status: "processing", originalBytes: 11 * 1024 * 1024 },
      }),
    },
    addEventListener() {},
  };
  const context = vm.createContext({
    document,
    window,
    EventSource: FakeEventSource,
    CustomEvent: class {},
    URLSearchParams,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    FormData,
    Date,
    Math,
    Number,
    JSON,
  });
  const script = fs.readFileSync(path.join(__dirname, "../public/app-simple.js"), "utf8");
  vm.runInContext(script, context);
  await vm.runInContext("submitCompression(new FormData())", context);

  const source = FakeEventSource.instances[0];
  source.emit({ status: "processing", progress: 0.72, originalBytes: 11 * 1024 * 1024 });
  source.onerror();
  assert.strictEqual(source.closed, false, "a transient connection error must allow EventSource to reconnect");
  assert.strictEqual(getNode("status-message").textContent, "connectionRetrying");

  source.emit({
    status: "done", progress: 1, resultBytes: 5 * 1024 * 1024,
    originalBytes: 11 * 1024 * 1024, targetBytes: 5 * 1024 * 1024,
    ratio: 5 / 11, downloadName: "example-compressed.pdf",
  });
  assert.strictEqual(getNode("status-percent").textContent, "100%");
  assert.strictEqual(getNode("download-row").hidden, false);
  assert.strictEqual(getNode("download-button").hidden, false);
  assert.strictEqual(source.closed, true, "terminal events should close the stream");
  console.log("PASS - compression reaches download state after a transient stream error");
}

run().catch(error => {
  console.error(`FAIL - ${error.stack}`);
  process.exitCode = 1;
});
