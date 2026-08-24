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

function normalizeRegion(value) {
  const region = String(value || "").trim().toUpperCase();
  if (!region || region === "XX") return "";
  return /^[A-Z]{2}$/.test(region) ? region : "";
}

function normalizeUtm(utm) {
  const input = utm && typeof utm === "object" ? utm : {};
  return {
    source: String(input.source || "").trim(),
    medium: String(input.medium || "").trim(),
    campaign: String(input.campaign || "").trim(),
    content: String(input.content || "").trim(),
    term: String(input.term || "").trim(),
  };
}

function normalizeLandingLanguage(value) {
  const language = String(value || "").trim().toLowerCase();
  if (language === "zh" || language.startsWith("zh-")) return "zh-CN";
  if (language === "en" || language.startsWith("en-")) return "en";
  return "";
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
    utm: normalizeUtm(event.utm),
    userAgent: event.userAgent || "",
    country: normalizeRegion(event.country),
    device: event.device || "",
    browser: event.browser || "",
    landingLanguage: normalizeLandingLanguage(event.landingLanguage),
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

function withinRange(ts, start, end) {
  const time = Date.parse(ts);
  if (!Number.isFinite(time)) return false;
  return time >= start.getTime() && time <= end.getTime() + 1000;
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function shortDayLabel(date) {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
}

function compareMetric(current, previous) {
  const nowValue = Number(current || 0);
  const previousValue = Number(previous || 0);
  return {
    current: nowValue,
    previous: previousValue,
    delta: nowValue - previousValue,
    percent: previousValue > 0 ? Math.round(((nowValue - previousValue) / previousValue) * 1000) / 10 : 0,
  };
}

function uniquePageViewVisitors(events) {
  return new Set(events
    .filter(event => event.event === "page_view")
    .map(event => event.clientId || event.sessionId)
    .filter(Boolean));
}

function dailyTrend(events, now, days = 30) {
  const rows = [];
  for (let index = days - 1; index >= 0; index--) {
    const day = startOfDay(new Date(now.getTime() - index * 86400000));
    const next = new Date(day.getTime() + 86400000 - 1);
    const dayEvents = events.filter(event => withinRange(event.ts, day, next));
    rows.push({
      date: isoDay(day),
      label: shortDayLabel(day),
      pageViews: dayEvents.filter(event => event.event === "page_view").length,
      visitors: uniquePageViewVisitors(dayEvents).size,
    });
  }
  return rows;
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

function regionFor(event) {
  return normalizeRegion(event.country) || "Unknown";
}

function countUniqueVisitorsByRegion(events) {
  const visitorRegions = new Map();
  for (const event of events) {
    const visitorId = event.clientId || event.sessionId;
    if (!visitorId) continue;
    const current = visitorRegions.get(visitorId) || "";
    const next = normalizeRegion(event.country);
    if (!current || (current === "Unknown" && next)) {
      visitorRegions.set(visitorId, next || "Unknown");
    }
  }

  const regionVisitors = new Map();
  const regionOrder = new Map();
  for (const [visitorId, region] of visitorRegions.entries()) {
    if (!regionVisitors.has(region)) {
      regionVisitors.set(region, new Set());
      regionOrder.set(region, regionOrder.size);
    }
    regionVisitors.get(region).add(visitorId);
  }
  return [...regionVisitors.entries()]
    .map(([region, visitors]) => ({ region, count: visitors.size }))
    .sort((a, b) => b.count - a.count || regionOrder.get(a.region) - regionOrder.get(b.region));
}

function sourceFor(event) {
  const utmSource = event.utm && event.utm.source;
  if (utmSource) return String(utmSource);
  const referrer = String(event.referrer || "");
  if (!referrer) return "Direct";
  try {
    const hostname = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    if (hostname === "libindesign.cn" || hostname.endsWith(".libindesign.cn")) {
      return "libindesign.cn";
    }
    return hostname;
  } catch {
    return "Direct";
  }
}

function sourceCategoryFor(event) {
  const source = sourceFor(event);
  if (source === "Direct") return "direct";
  const normalizedSource = source.toLowerCase().replace(/^www\./, "");
  if (normalizedSource === "libindesign.cn" || normalizedSource.endsWith(".libindesign.cn")) {
    return "owned_referral";
  }
  if ([
    "chatgpt.com",
    "perplexity.ai",
    "claude.ai",
    "gemini.google.com",
    "copilot.microsoft.com",
  ].some(domain => normalizedSource === domain || normalizedSource.endsWith(`.${domain}`))) {
    return "ai_referral";
  }
  if (event.utm && event.utm.source) return "campaign";
  return "referral";
}

function referrerPath(event) {
  const referrer = String(event.referrer || "");
  if (!referrer) return "";
  try {
    const parsed = new URL(referrer);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname}`.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function promotionKeyFor(event) {
  const utm = normalizeUtm(event.utm);
  const source = sourceFor(event);
  const medium = utm.medium || "";
  const campaign = utm.campaign || "";
  const content = utm.content || campaign || referrerPath(event) || "未标记内容";
  return { source, medium, campaign, content };
}

function summarizePromotions(events) {
  const rows = new Map();
  for (const event of events) {
    const attribution = promotionKeyFor(event);
    if (!attribution.source || attribution.source === "Direct") continue;
    const key = [attribution.source, attribution.medium, attribution.campaign, attribution.content].join("\u0001");
    if (!rows.has(key)) {
      rows.set(key, {
        ...attribution,
        visits: 0,
        visitors: 0,
        compressions: 0,
        downloads: 0,
        visitorIds: new Set(),
      });
    }
    const row = rows.get(key);
    const visitorId = event.clientId || event.sessionId;
    if (visitorId) row.visitorIds.add(visitorId);
    if (event.event === "page_view") row.visits++;
    if (event.event === "compress_success") row.compressions++;
    if (event.event === "download_clicked") row.downloads++;
  }
  return [...rows.values()]
    .map(row => ({
      source: row.source,
      medium: row.medium,
      campaign: row.campaign,
      content: row.content,
      visits: row.visits,
      visitors: row.visitorIds.size,
      compressions: row.compressions,
      downloads: row.downloads,
    }))
    .sort((a, b) =>
      b.visits - a.visits ||
      b.compressions - a.compressions ||
      b.downloads - a.downloads ||
      a.source.localeCompare(b.source)
    );
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
  const jobId = String(data.jobId || "").trim();
  const file = String(data.fileName || "").toLowerCase();
  return `${actor}|${jobId || file}`;
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

const PROCESSING_STALE_MS = Math.max(
  60_000,
  Number(process.env.ANALYTICS_PROCESSING_TIMEOUT_MS) || 10 * 60_000
);

function mergeRecentFileEvents(events, now = new Date()) {
  const rows = new Map();
  for (const event of events) {
    const data = eventData(event);
    if (!data.fileName || !["file_selected", "compress_started", "compress_success", "compress_error", "download_clicked"].includes(event.event)) continue;
    const key = uploadKey(event);
    const existing = rows.get(key) || {
      ts: event.ts,
      fileName: data.fileName,
      category: data.fileCategory || classifyFileName(data.fileName),
      fileBytes: 0,
      targetMB: "",
      targetBytes: 0,
      resultBytes: 0,
      status: "pending",
      reason: "",
    };
    if (Date.parse(event.ts || 0) > Date.parse(existing.ts || 0)) existing.ts = event.ts;
    existing.fileName = existing.fileName || data.fileName;
    existing.category = existing.category || data.fileCategory || classifyFileName(data.fileName);
    existing.fileBytes = existing.fileBytes || data.fileBytes || data.originalBytes || 0;
    existing.targetMB = existing.targetMB || data.targetMB || "";
    existing.targetBytes = existing.targetBytes || data.targetBytes || (Number(data.targetMB || 0) ? Number(data.targetMB) * 1048576 : 0);
    existing.resultBytes = existing.resultBytes || data.resultBytes || 0;
    if (event.event === "compress_success" || event.event === "download_clicked") existing.status = "success";
    if (event.event === "compress_error") {
      existing.status = "error";
      existing.reason = data.reason || data.code || "Compression failed";
    }
    if (event.event === "compress_started" && existing.status === "pending") existing.status = "processing";
    rows.set(key, existing);
  }
  const staleAt = now.getTime() - PROCESSING_STALE_MS;
  for (const row of rows.values()) {
    const rowTime = Date.parse(row.ts || 0);
    if (row.status === "processing" && Number.isFinite(rowTime) && rowTime <= staleAt) {
      row.status = "timeout";
      row.reason = "未收到完成事件，可能是压缩超时或服务器重启";
    }
  }
  return [...rows.values()]
    .sort((a, b) => Date.parse(b.ts || 0) - Date.parse(a.ts || 0))
    .slice(0, 30);
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

function averageSavingsRate(events) {
  const rates = events
    .filter(event => event.event === "compress_success")
    .map(event => {
      const data = eventData(event);
      const original = Number(data.originalBytes || data.fileBytes || 0);
      const result = Number(data.resultBytes || 0);
      if (!Number.isFinite(original) || !Number.isFinite(result) || original <= 0 || result <= 0 || result > original) return null;
      return ((original - result) / original) * 100;
    })
    .filter(value => Number.isFinite(value));
  return rates.length ? Math.round(rates.reduce((sum, value) => sum + value, 0) / rates.length) : 0;
}

function averageCompressionSeconds(events) {
  const sorted = [...events].sort((a, b) => Date.parse(a.ts || 0) - Date.parse(b.ts || 0));
  const starts = new Map();
  const completed = new Set();
  const durations = [];
  for (const event of sorted) {
    const data = eventData(event);
    if (!data.fileName || !["compress_started", "compress_success"].includes(event.event)) continue;
    const time = Date.parse(event.ts || 0);
    if (!Number.isFinite(time)) continue;
    const key = uploadKey(event);
    if (event.event === "compress_started") {
      const existing = starts.get(key);
      if (!Number.isFinite(existing) || time < existing) starts.set(key, time);
      continue;
    }
    if (completed.has(key)) continue;
    const start = starts.get(key);
    if (Number.isFinite(start) && time >= start) {
      durations.push((time - start) / 1000);
      completed.add(key);
    }
  }
  return durations.length
    ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
    : 0;
}

function summarizeAnalytics(events, now = new Date()) {
  const sorted = [...events].sort((a, b) => Date.parse(b.ts || 0) - Date.parse(a.ts || 0));
  const today = events.filter(event => sameUtcDay(event.ts, now));
  const last7d = events.filter(event => withinDays(event.ts, now, 7));
  const last30d = events.filter(event => withinDays(event.ts, now, 30));
  const previous30Start = new Date(now.getTime() - 60 * 86400000);
  const previous30End = new Date(now.getTime() - 30 * 86400000 - 1);
  const previous30d = events.filter(event => withinRange(event.ts, previous30Start, previous30End));

  const successes7d = last7d.filter(event => event.event === "compress_success").length;
  const errors7d = last7d.filter(event => event.event === "compress_error").length;
  const clientIds7d = uniquePageViewVisitors(last7d);
  const clientIds30d = uniquePageViewVisitors(last30d);
  const previousClientIds30d = uniquePageViewVisitors(previous30d);
  const dwellEvents = last7d.filter(event => event.event === "session_end" && Number.isFinite(Number(eventData(event).dwellSeconds)));
  const avgDwell = dwellEvents.length
    ? Math.round(dwellEvents.reduce((sum, event) => sum + Number(eventData(event).dwellSeconds), 0) / dwellEvents.length)
    : 0;

  const fileEvents = fileActivityEvents(last30d);
  const compressionEvents = last30d.filter(event => event.event === "compress_success");
  const errorEvents = last30d.filter(event => event.event === "compress_error");
  const previousCompressionEvents = previous30d.filter(event => event.event === "compress_success");
  const currentPageViews30d = last30d.filter(event => event.event === "page_view").length;
  const previousPageViews30d = previous30d.filter(event => event.event === "page_view").length;
  const currentDownloads30d = last30d.filter(event => event.event === "download_clicked").length;
  const previousDownloads30d = previous30d.filter(event => event.event === "download_clicked").length;
  const completedTaskCount = [...compressionEvents, ...errorEvents]
    .filter(event => eventData(event).fileName)
    .length;
  const startedTaskCount = Math.max(
    dedupeCount(last30d, event => ["compress_started", "compress_success", "compress_error", "download_clicked"].includes(event.event)),
    completedTaskCount
  );
  const selectedFileCount = Math.max(
    dedupeCount(last30d, event => ["file_selected", "compress_started", "compress_success", "compress_error", "download_clicked"].includes(event.event)),
    startedTaskCount
  );

  return {
    generatedAt: now.toISOString(),
    overview: {
      todayPageViews: today.filter(event => event.event === "page_view").length,
      pageViews7d: last7d.filter(event => event.event === "page_view").length,
      pageViews30d: currentPageViews30d,
      uniqueVisitors7d: clientIds7d.size,
      uniqueVisitors30d: clientIds30d.size,
      todayCompressions: today.filter(event => event.event === "compress_success").length,
      todayDownloads: today.filter(event => event.event === "download_clicked").length,
      successRate7d: successRate(successes7d, errors7d),
      comparisons: {
        pageViews30d: compareMetric(currentPageViews30d, previousPageViews30d),
        uniqueVisitors30d: compareMetric(clientIds30d.size, previousClientIds30d.size),
        compressSuccess30d: compareMetric(compressionEvents.length, previousCompressionEvents.length),
        downloads30d: compareMetric(currentDownloads30d, previousDownloads30d),
      },
    },
    trends: {
      daily: dailyTrend(last30d, now, 30),
    },
    acquisition: {
      sources: countBy(last30d.filter(event => event.event === "page_view"), sourceFor, "source"),
      channels: countBy(last30d.filter(event => event.event === "page_view"), sourceCategoryFor, "channel"),
      utmSources: countBy(last30d, event => event.utm && event.utm.source, "source"),
      utmCampaigns: countBy(last30d, event => event.utm && event.utm.campaign, "campaign"),
      promotions: summarizePromotions(last30d),
    },
    geo: {
      regions: countUniqueVisitorsByRegion(last30d),
    },
    funnel: {
      page_view: last30d.filter(event => event.event === "page_view").length,
      file_selected: selectedFileCount,
      compress_started: startedTaskCount,
      compress_success: compressionEvents.length,
      download_clicked: last30d.filter(event => event.event === "download_clicked").length,
    },
    behavior: {
      averageDwellSeconds: avgDwell,
      averageCompressionSeconds: averageCompressionSeconds(last7d),
      bounceEstimate: 0,
    },
    compression: {
      averageSavingsRate: averageSavingsRate(compressionEvents),
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
      recentFileNames: mergeRecentFileEvents(last30d, now),
    },
    recentEvents: sorted.slice(0, 100),
  };
}

function csvValue(value) {
  const text = String(value == null ? "" : value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function eventToCsvRow(event) {
  const data = eventData(event);
  const utm = normalizeUtm(event.utm);
  return [
    event.ts || "",
    event.event || "",
    sourceFor(event),
    utm.medium || "",
    utm.campaign || "",
    utm.content || "",
    event.country || "Unknown",
    event.device || "",
    event.browser || "",
    event.path || "",
    event.referrer || "",
    event.sessionId || "",
    event.clientId || "",
    data.fileName || "",
    data.fileCategory || "",
    uploadBytes(event) || "",
    data.targetMB || "",
    data.targetBytes || "",
    data.resultBytes || "",
    data.reachedTarget == null ? "" : data.reachedTarget,
    data.rasterized == null ? "" : data.rasterized,
    data.reason || "",
    data.dwellSeconds || "",
  ].map(csvValue).join(",");
}

function rangeStart(range, now = new Date()) {
  if (range === "all") return null;
  const months = { "1m": 1, "3m": 3, "5m": 5 }[range];
  if (!months) return null;
  return new Date(now.getTime() - months * 31 * 86400000);
}

function filterEventsByExportRange(events, range, now = new Date()) {
  const start = rangeStart(range, now);
  if (!start) return [...events];
  return events.filter(event => {
    const time = Date.parse(event.ts);
    return Number.isFinite(time) && time >= start.getTime() && time <= now.getTime() + 1000;
  });
}

function exportAnalyticsCsv(events, range = "all", now = new Date()) {
  const header = [
    "时间", "事件", "平台", "媒介", "活动", "文章/内容", "地区", "设备", "浏览器", "路径",
    "来源链接", "会话ID", "访客ID", "文件名", "文件分类", "原始文件大小Bytes", "用户输入目标MB",
    "用户输入目标Bytes", "压缩后大小Bytes", "是否达标", "是否栅格化", "错误原因", "停留秒数",
  ].map(csvValue).join(",");
  const rows = filterEventsByExportRange(events, range, now)
    .sort((a, b) => Date.parse(a.ts || 0) - Date.parse(b.ts || 0))
    .map(eventToCsvRow);
  return ["\uFEFF" + header, ...rows].join("\n") + "\n";
}

module.exports = {
  normalizeEvent,
  classifyFileName,
  normalizeRegion,
  normalizeUtm,
  normalizeLandingLanguage,
  sourceFor,
  sourceCategoryFor,
  exportAnalyticsCsv,
  filterEventsByExportRange,
  appendAnalyticsEvent,
  readAnalyticsEvents,
  summarizeAnalytics,
  mergeRecentFileEvents,
  normalizeEvent,
};
