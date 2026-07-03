"use strict";
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const CATEGORY_RULES = [
  ["presentation", ["presentation", "slides", "slide", "deck", "keynote", "ppt"]],
  ["design", ["portfolio", "design", "figma", "mockup", "ui", "ux", "brochure"]],
  ["resume", ["resume", "cv"]],
  ["document", ["form", "application", "report", "invoice", "contract"]],
  ["academic", ["paper", "thesis", "assignment", "research"]],
  ["scan", ["scan", "scanned"]],
];

function classifyFileName(fileName) {
  const normalized = String(fileName || "").toLowerCase();
  for (const [category, words] of CATEGORY_RULES) {
    if (words.some(word => normalized.includes(word))) return category;
  }
  return "other";
}

function normalizeEvent(event) {
  const data = { ...(event && event.data ? event.data : {}) };
  if (data.fileName && !data.fileCategory) {
    data.fileCategory = classifyFileName(data.fileName);
  }
  return {
    ts: event.ts || new Date().toISOString(),
    event: String(event.event || "unknown"),
    sessionId: event.sessionId || "",
    clientId: event.clientId || "",
    path: event.path || "",
    referrer: event.referrer || "",
    utm: event.utm || {},
    userAgent: event.userAgent || "",
    country: event.country || "",
    device: event.device || "",
    browser: event.browser || "",
    data,
  };
}

async function appendAnalyticsEvent(filePath, event) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const normalized = normalizeEvent(event || {});
  await fsp.appendFile(filePath, `${JSON.stringify(normalized)}\n`, "utf8");
  return normalized;
}

async function readAnalyticsEvents(filePath) {
  let raw = "";
  try {
    raw = await fsp.readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  const events = [];
  for (const line of raw.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {}
  }
  return events;
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function withinDays(ts, now, days) {
  const time = Date.parse(ts);
  if (!Number.isFinite(time)) return false;
  return time >= now.getTime() - days * 86400000 && time <= now.getTime() + 1000;
}

function sameUtcDay(ts, now) {
  const time = Date.parse(ts);
  if (!Number.isFinite(time)) return false;
  return time >= startOfDay(now).getTime() && time <= now.getTime() + 1000;
}

function countBy(items, keyFn, labelKey, countKey = "count") {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ [labelKey]: key, [countKey]: count }))
    .sort((a, b) => b[countKey] - a[countKey] || String(a[labelKey]).localeCompare(String(b[labelKey])));
}

function sourceFor(event) {
  const utmSource = event.utm && event.utm.source;
  if (utmSource) return String(utmSource);
  const referrer = String(event.referrer || "");
  if (!referrer) return "Direct";
  try {
    return new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return "Other";
  }
}

function bucketMB(bytes) {
  const mb = Number(bytes || 0) / 1048576;
  if (!Number.isFinite(mb) || mb <= 0) return "unknown";
  if (mb <= 1) return "0-1MB";
  if (mb <= 5) return "1-5MB";
  if (mb <= 10) return "5-10MB";
  if (mb <= 25) return "10-25MB";
  if (mb <= 50) return "25-50MB";
  if (mb <= 100) return "50-100MB";
  return "100MB+";
}

function eventData(event) {
  return event && event.data ? event.data : {};
}

function uploadBytes(event) {
  const data = eventData(event);
  return data.fileBytes || data.originalBytes || 0;
}

function uploadKey(event) {
  const data = eventData(event);
  const actor = event.sessionId || event.clientId || "";
  const file = String(data.fileName || "").toLowerCase();
  return `${actor}|${file}`;
}

function dedupeByUpload(events) {
  const seen = new Set();
  const out = [];
  for (const event of events) {
    const data = eventData(event);
    if (!data.fileName) continue;
    const key = uploadKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

function dedupeCount(events, predicate) {
  return dedupeByUpload(events.filter(predicate)).length;
}

function fileActivityEvents(events) {
  const useful = events.filter(event => {
    const data = eventData(event);
    return data.fileName && ["file_selected", "compress_started", "compress_success", "compress_error", "download_clicked"].includes(event.event);
  });
  return dedupeByUpload(useful);
}

function commonKeywords(fileEvents) {
  const stop = new Set(["pdf", "final", "copy", "new", "old", "document", "file", "compressed"]);
  const counts = new Map();
  for (const event of fileEvents) {
    const fileName = String(eventData(event).fileName || "").toLowerCase();
    for (const token of fileName.replace(/\.[a-z0-9]+$/i, "").split(/[^a-z0-9]+/i)) {
      if (token.length < 3 || stop.has(token)) continue;
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
    .slice(0, 20);
}

function successRate(successes, errors) {
  const total = successes + errors;
  return total > 0 ? Math.round((successes / total) * 100) : 0;
}

function summarizeAnalytics(events, now = new Date()) {
  const sorted = [...events].sort((a, b) => Date.parse(b.ts || 0) - Date.parse(a.ts || 0));
  const today = events.filter(event => sameUtcDay(event.ts, now));
  const last7d = events.filter(event => withinDays(event.ts, now, 7));
  const last30d = events.filter(event => withinDays(event.ts, now, 30));

  const successes7d = last7d.filter(event => event.event === "compress_success").length;
  const errors7d = last7d.filter(event => event.event === "compress_error").length;
  const clientIds7d = new Set(last7d.map(event => event.clientId || event.sessionId).filter(Boolean));
  const dwellEvents = last7d.filter(event => event.event === "session_end" && Number.isFinite(Number(eventData(event).dwellSeconds)));
  const avgDwell = dwellEvents.length
    ? Math.round(dwellEvents.reduce((sum, event) => sum + Number(eventData(event).dwellSeconds), 0) / dwellEvents.length)
    : 0;

  const fileEvents = fileActivityEvents(last30d);
  const compressionEvents = last30d.filter(event => event.event === "compress_success");
  const errorEvents = last30d.filter(event => event.event === "compress_error");

  return {
    generatedAt: now.toISOString(),
    overview: {
      todayPageViews: today.filter(event => event.event === "page_view").length,
      pageViews7d: last7d.filter(event => event.event === "page_view").length,
      pageViews30d: last30d.filter(event => event.event === "page_view").length,
      uniqueVisitors7d: clientIds7d.size,
      todayCompressions: today.filter(event => event.event === "compress_success").length,
      todayDownloads: today.filter(event => event.event === "download_clicked").length,
      successRate7d: successRate(successes7d, errors7d),
    },
    acquisition: {
      sources: countBy(last30d.filter(event => event.event === "page_view"), sourceFor, "source"),
      utmSources: countBy(last30d, event => event.utm && event.utm.source, "source"),
      utmCampaigns: countBy(last30d, event => event.utm && event.utm.campaign, "campaign"),
    },
    funnel: {
      page_view: last30d.filter(event => event.event === "page_view").length,
      file_selected: dedupeCount(last30d, event => ["file_selected", "compress_started", "compress_success", "compress_error", "download_clicked"].includes(event.event)),
      compress_started: dedupeCount(last30d, event => ["compress_started", "compress_success", "compress_error", "download_clicked"].includes(event.event)),
      compress_success: compressionEvents.length,
      download_clicked: last30d.filter(event => event.event === "download_clicked").length,
    },
    behavior: {
      averageDwellSeconds: avgDwell,
      bounceEstimate: 0,
    },
    compression: {
      uploadSizeBuckets: countBy(fileEvents, event => bucketMB(uploadBytes(event)), "bucket"),
      targetSizeBuckets: countBy(last30d.filter(event => event.event === "compress_started" || event.event === "compress_success"), event => {
        const data = eventData(event);
        return data.targetBytes || Number(data.targetMB || 0) * 1048576;
      }, "bucket"),
      resultSizeBuckets: countBy(compressionEvents, event => bucketMB(eventData(event).resultBytes), "bucket"),
      reachedTargetRate: compressionEvents.length
        ? Math.round((compressionEvents.filter(event => eventData(event).reachedTarget === true || eventData(event).reachedTarget === 1).length / compressionEvents.length) * 100)
        : 0,
      rasterizedRate: compressionEvents.length
        ? Math.round((compressionEvents.filter(event => eventData(event).rasterized === true || eventData(event).rasterized === 1).length / compressionEvents.length) * 100)
        : 0,
      errorReasons: countBy(errorEvents, event => eventData(event).reason || "Unknown", "reason"),
    },
    files: {
      categories: countBy(fileEvents, event => eventData(event).fileCategory || classifyFileName(eventData(event).fileName), "category"),
      keywords: commonKeywords(fileEvents),
      recentFileNames: sorted
        .filter(event => ["file_selected", "compress_started", "compress_success", "compress_error"].includes(event.event) && eventData(event).fileName)
        .filter((event, index, arr) => arr.findIndex(item => uploadKey(item) === uploadKey(event)) === index)
        .slice(0, 30)
        .map(event => ({
          ts: event.ts,
          fileName: eventData(event).fileName,
          category: eventData(event).fileCategory || classifyFileName(eventData(event).fileName),
          fileBytes: uploadBytes(event),
        })),
    },
    recentEvents: sorted.slice(0, 100),
  };
}

module.exports = {
  classifyFileName,
  appendAnalyticsEvent,
  readAnalyticsEvents,
  summarizeAnalytics,
  normalizeEvent,
};
