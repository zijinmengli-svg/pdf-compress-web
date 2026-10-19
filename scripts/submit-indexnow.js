"use strict";

const fs = require("fs");
const path = require("path");
const { validIndexNowKey, changedSitemapUrls, submitIndexNow } = require("../lib/indexnow");

async function main() {
  const key = process.env.INDEXNOW_KEY || "";
  if (!validIndexNowKey(key)) throw new Error("Set a valid INDEXNOW_KEY first");
  const since = process.env.INDEXNOW_SINCE || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const xml = fs.readFileSync(path.join(__dirname, "..", "public", "sitemap.xml"), "utf8");
  const urls = changedSitemapUrls(xml, since);
  if (!urls.length) {
    console.log("No changed sitemap URLs to submit.");
    return;
  }
  if (process.argv.includes("--dry-run")) {
    console.log(`Ready to submit ${urls.length} changed URL(s) since ${since}:`);
    urls.forEach(url => console.log(url));
    return;
  }
  const keyLocation = `https://tinypdf.cn/${key}.txt`;
  let keyResponse;
  try {
    keyResponse = await fetch(keyLocation, { signal: AbortSignal.timeout(10000) });
  } catch {
    throw new Error("Cannot reach the live IndexNow key file");
  }
  if (!keyResponse.ok || (await keyResponse.text()).trim() !== key) {
    throw new Error("Live IndexNow key file is unavailable or does not match");
  }
  const result = await submitIndexNow({ key, urls });
  console.log(`IndexNow received ${result.count} URL(s), HTTP ${result.status}. Check Bing Webmaster Tools for crawl and index status.`);
}

if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = { main };
