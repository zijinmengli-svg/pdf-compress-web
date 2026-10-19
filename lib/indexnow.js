"use strict";

const HOST = "tinypdf.cn";
const ENDPOINT = "https://api.indexnow.org/indexnow";

function validIndexNowKey(value) {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,128}$/.test(value);
}

function validProductionUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === HOST && !url.port &&
      !url.username && !url.password && !url.search && !url.hash && url.href === value;
  } catch {
    return false;
  }
}

function changedSitemapUrls(xml, since) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(since || ""))) throw new Error("Invalid since date");
  const urls = new Set();
  for (const match of String(xml || "").matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = match[1].match(/<loc>([^<]+)<\/loc>/);
    const lastmod = match[1].match(/<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/);
    if (!loc || !lastmod || lastmod[1] < since) continue;
    const value = loc[1].trim();
    if (validProductionUrl(value)) urls.add(value);
  }
  return [...urls];
}

async function submitIndexNow({ key, urls, fetcher = fetch }) {
  if (!validIndexNowKey(key)) throw new Error("Invalid IndexNow key");
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 10000 || urls.some(url => !validProductionUrl(url))) {
    throw new Error("Invalid URL list or host");
  }
  let response;
  try {
    response = await fetcher(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: HOST,
        key,
        keyLocation: `https://${HOST}/${key}.txt`,
        urlList: [...new Set(urls)],
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("IndexNow network request failed");
  }
  if (response.status === 429) throw new Error("IndexNow rate limit reached");
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`IndexNow rejected submission (HTTP ${response.status})`);
  }
  return { status: response.status, count: urls.length };
}

module.exports = { validIndexNowKey, validProductionUrl, changedSitemapUrls, submitIndexNow };
