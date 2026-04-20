const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3487);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const BUILD_DIR = path.join(ROOT, ".build");
const SCRIPTS_DIR = path.join(ROOT, "scripts");
const COMPRESS_SOURCE = path.join(SCRIPTS_DIR, "compress_pdf.swift");
const RASTER_SOURCE = path.join(SCRIPTS_DIR, "rasterize_pdf.swift");
const INSPECT_SOURCE = path.join(SCRIPTS_DIR, "inspect_pdf.swift");
const COMPRESS_BINARY = path.join(BUILD_DIR, "compress-pdf");
const RASTER_BINARY = path.join(BUILD_DIR, "rasterize-pdf");
const INSPECT_BINARY = path.join(BUILD_DIR, "inspect-pdf");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const ANALYTICS_FILE = path.join(DATA_DIR, "analytics.json");
const VISITOR_COOKIE = "pdf_tool_visitor";
const ADMIN_COOKIE = "pdf_tool_admin";
const MAX_EVENTS = 20000;
const MAX_EXCEPTION_TASKS = 1000;
const sessions = new Map();
const jobs = new Map();

const QUALITY_STEPS = [
  { scale: 1.0, quality: 0.98 },
  { scale: 0.98, quality: 0.96 },
  { scale: 0.96, quality: 0.94 },
  { scale: 0.94, quality: 0.92 },
  { scale: 0.92, quality: 0.9 },
  { scale: 0.88, quality: 0.86 },
  { scale: 0.84, quality: 0.82 },
  { scale: 0.8, quality: 0.78 },
  { scale: 0.76, quality: 0.74 },
  { scale: 0.72, quality: 0.7 },
  { scale: 0.68, quality: 0.66 },
  { scale: 0.64, quality: 0.62 },
  { scale: 0.6, quality: 0.58 },
  { scale: 0.56, quality: 0.54 },
  { scale: 0.52, quality: 0.5 },
  { scale: 0.48, quality: 0.46 },
  { scale: 0.44, quality: 0.42 },
  { scale: 0.4, quality: 0.38 },
  { scale: 0.36, quality: 0.34 },
  { scale: 0.32, quality: 0.3 },
  { scale: 0.28, quality: 0.26 },
  { scale: 0.24, quality: 0.22 },
  { scale: 0.2, quality: 0.2 }
];

const RASTER_STEPS = [
  { dpi: 144, quality: 0.82, grayscale: false },
  { dpi: 120, quality: 0.74, grayscale: false },
  { dpi: 96, quality: 0.66, grayscale: false },
  { dpi: 84, quality: 0.58, grayscale: false },
  { dpi: 72, quality: 0.5, grayscale: false },
  { dpi: 60, quality: 0.42, grayscale: false },
  { dpi: 48, quality: 0.34, grayscale: false },
  { dpi: 42, quality: 0.28, grayscale: false },
  { dpi: 36, quality: 0.24, grayscale: true },
  { dpi: 30, quality: 0.18, grayscale: true },
  { dpi: 24, quality: 0.14, grayscale: true },
  { dpi: 18, quality: 0.1, grayscale: true },
  { dpi: 12, quality: 0.08, grayscale: true },
  { dpi: 8, quality: 0.05, grayscale: true },
  { dpi: 6, quality: 0.03, grayscale: true }
];

const DEFAULT_SETTINGS = {
  siteName: "PDF 压缩 Skill",
  adminUsername: "admin",
  adminPasswordHash: sha256("admin123456"),
  maxUploadMB: 250,
  cleanupMinutes: 60,
  compressionTimeoutSeconds: 300,
  freeUsageEnabled: true,
  freeUsageLimit: 3,
  freeUsageResetMode: "daily",
  billingEnabled: false,
  packages: [
    {
      id: "pkg_starter",
      name: "单次压缩包",
      priceCny: 9.9,
      description: "适合临时使用",
      entitlementType: "credit_pack",
      entitlementValue: 1,
      buyLink: "",
      enabled: true
    },
    {
      id: "pkg_pro",
      name: "5 次压缩包",
      priceCny: 29.9,
      description: "适合短期集中使用",
      entitlementType: "credit_pack",
      entitlementValue: 5,
      buyLink: "",
      enabled: true
    }
  ],
  paymentMethods: [
    {
      id: "alipay_manual",
      name: "支付宝",
      link: "",
      qrCodeUrl: "",
      instructions: "请按套餐金额付款，付款后点击“我已支付”。",
      postPaymentInstructions: "如支付后未生效，请联系客服并附上支付截图。",
      enabled: true
    }
  ],
  supportEmail: "zijinnmengli@gmail.com",
  supportMessage: "如遇支付、下载或退费问题，请联系：zijinnmengli@gmail.com。请在邮件中附上订单信息、支付截图或退款账户信息，以便尽快处理。"
};

const analyticsState = {
  visitors: {},
  events: [],
  exceptionTasks: [],
  refundRequests: []
};

let settingsState = { ...DEFAULT_SETTINGS };
let persistQueue = Promise.resolve();

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function now() {
  return Date.now();
}

function dayKey(timestamp) {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateTime(ts) {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function bytesToMB(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}

function parseSizeToBytes(valueMB) {
  return Math.round(Number(valueMB) * 1024 * 1024);
}

function sanitizeFileName(name) {
  const base = path.basename(name || "compressed.pdf");
  return base.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
}

function fileNameWithSuffix(name, suffix) {
  const parsed = path.parse(name);
  return `${parsed.name}${suffix}${parsed.ext || ".pdf"}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function ensureDirectories() {
  await Promise.all([
    fsp.mkdir(DATA_DIR, { recursive: true }),
    fsp.mkdir(BUILD_DIR, { recursive: true })
  ]);
}

async function loadState() {
  await ensureDirectories();
  try {
    const raw = await fsp.readFile(SETTINGS_FILE, "utf8");
    settingsState = normalizeSettings(JSON.parse(raw));
  } catch {
    settingsState = normalizeSettings(DEFAULT_SETTINGS);
    await fsp.writeFile(SETTINGS_FILE, `${JSON.stringify(settingsState, null, 2)}\n`);
  }

  try {
    const raw = await fsp.readFile(ANALYTICS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    analyticsState.visitors = parsed.visitors || {};
    analyticsState.events = parsed.events || [];
    analyticsState.exceptionTasks = parsed.exceptionTasks || [];
    analyticsState.refundRequests = parsed.refundRequests || [];
  } catch {
    await persistState();
  }
}

function normalizePackages(packages) {
  if (!Array.isArray(packages) || packages.length === 0) {
    return DEFAULT_SETTINGS.packages.map((item) => ({ ...item }));
  }
  return packages.map((item, index) => ({
    id: String(item.id || `pkg_${index + 1}`),
    name: String(item.name || `套餐 ${index + 1}`),
    priceCny: Math.max(0, Number(item.priceCny) || 0),
    description: String(item.description || ""),
    entitlementType: item.entitlementType === "duration_days" ? "duration_days" : "credit_pack",
    entitlementValue: Math.max(1, Number(item.entitlementValue) || 1),
    buyLink: String(item.buyLink || ""),
    enabled: item.enabled !== false
  }));
}

function normalizePaymentMethods(methods) {
  if (!Array.isArray(methods) || methods.length === 0) {
    return DEFAULT_SETTINGS.paymentMethods.map((item) => ({ ...item }));
  }
  return methods.map((item, index) => ({
    id: String(item.id || `payment_${index + 1}`),
    name: String(item.name || `收款方式 ${index + 1}`),
    link: String(item.link || ""),
    qrCodeUrl: String(item.qrCodeUrl || ""),
    instructions: String(item.instructions || ""),
    postPaymentInstructions: String(item.postPaymentInstructions || ""),
    enabled: item.enabled !== false
  }));
}

function normalizeSettings(input) {
  const merged = { ...DEFAULT_SETTINGS, ...input };
  return {
    ...merged,
    maxUploadMB: Math.max(1, Number(merged.maxUploadMB) || 250),
    cleanupMinutes: Math.max(5, Number(merged.cleanupMinutes) || 60),
    compressionTimeoutSeconds: Math.max(30, Number(merged.compressionTimeoutSeconds) || 300),
    freeUsageEnabled: Boolean(merged.freeUsageEnabled),
    freeUsageLimit: Math.max(0, Number(merged.freeUsageLimit) || 0),
    freeUsageResetMode: merged.freeUsageResetMode === "lifetime" ? "lifetime" : "daily",
    billingEnabled: Boolean(merged.billingEnabled),
    packages: normalizePackages(merged.packages),
    paymentMethods: normalizePaymentMethods(merged.paymentMethods),
    supportEmail: String(merged.supportEmail || DEFAULT_SETTINGS.supportEmail),
    supportMessage: String(merged.supportMessage || DEFAULT_SETTINGS.supportMessage),
    adminUsername: String(merged.adminUsername || DEFAULT_SETTINGS.adminUsername),
    adminPasswordHash: String(merged.adminPasswordHash || DEFAULT_SETTINGS.adminPasswordHash)
  };
}

async function persistState() {
  await Promise.all([
    fsp.writeFile(SETTINGS_FILE, `${JSON.stringify(settingsState, null, 2)}\n`),
    fsp.writeFile(
      ANALYTICS_FILE,
      `${JSON.stringify({
        visitors: analyticsState.visitors,
        events: analyticsState.events.slice(-MAX_EVENTS),
        exceptionTasks: analyticsState.exceptionTasks.slice(-MAX_EXCEPTION_TASKS),
        refundRequests: analyticsState.refundRequests.slice(-2000)
      }, null, 2)}\n`
    )
  ]);
}

function queuePersist() {
  persistQueue = persistQueue.then(persistState).catch(() => {});
  return persistQueue;
}

function buildError(status, code, message, extra = {}) {
  return {
    status,
    code,
    message,
    ...extra
  };
}

function json(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, code, message, extra = {}) {
  json(res, statusCode, buildError(statusCode, code, message, extra));
}

function text(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    ...extraHeaders
  });
  res.end(payload);
}

function notFound(res) {
  text(res, 404, "Not found");
}

function noContent(res, extraHeaders = {}) {
  res.writeHead(204, extraHeaders);
  res.end();
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const cookies = {};
  for (const pair of raw.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return cookies;
}

function appendHeader(res, name, value) {
  const current = res.getHeader(name);
  if (!current) {
    res.setHeader(name, value);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader(name, current.concat(value));
    return;
  }
  res.setHeader(name, [current, value]);
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || "/"}`, `SameSite=${options.sameSite || "Lax"}`];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
  appendHeader(res, "Set-Cookie", parts.join("; "));
}

function clearCookie(res, name) {
  appendHeader(res, "Set-Cookie", `${name}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`);
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "";
}

function visitorTemplate(req, id) {
  return {
    id,
    firstSeenAt: now(),
    lastSeenAt: now(),
    firstIp: clientIp(req),
    lastIp: clientIp(req),
    userAgent: req.headers["user-agent"] || "",
    pageVisits: 0,
    uploadClicks: 0,
    uploadSuccess: 0,
    uploadFailure: 0,
    targetInputs: 0,
    compressStarts: 0,
    compressSuccess: 0,
    compressPartialSuccess: 0,
    compressFailure: 0,
    downloadClicks: 0,
    downloadSuccess: 0,
    paymentTriggerCount: 0,
    packageViews: 0,
    purchaseClicks: 0,
    supportClicks: 0,
    refundRequests: 0,
    refundProcessed: 0,
    quotaUsed: 0,
    quotaResetKey: dayKey(now()),
    paidCredits: 0,
    memberUntil: null
  };
}

function getVisitor(req, res) {
  const cookies = parseCookies(req);
  let visitorId = cookies[VISITOR_COOKIE];
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    setCookie(res, VISITOR_COOKIE, visitorId, { maxAge: 60 * 60 * 24 * 365 });
  }
  if (!analyticsState.visitors[visitorId]) {
    analyticsState.visitors[visitorId] = visitorTemplate(req, visitorId);
  }
  const visitor = analyticsState.visitors[visitorId];
  visitor.lastSeenAt = now();
  visitor.lastIp = clientIp(req);
  visitor.userAgent = req.headers["user-agent"] || visitor.userAgent;
  applyQuotaReset(visitor);
  return visitor;
}

function applyQuotaReset(visitor) {
  if (settingsState.freeUsageResetMode !== "daily") return;
  const current = dayKey(now());
  if (visitor.quotaResetKey !== current) {
    visitor.quotaResetKey = current;
    visitor.quotaUsed = 0;
  }
}

function incrementVisitorCounter(visitor, type) {
  const map = {
    page_visit: "pageVisits",
    upload_click: "uploadClicks",
    upload_success: "uploadSuccess",
    upload_failure: "uploadFailure",
    target_size_input: "targetInputs",
    compress_start: "compressStarts",
    compress_success: "compressSuccess",
    compress_partial_success: "compressPartialSuccess",
    compress_failure: "compressFailure",
    download_click: "downloadClicks",
    download_success: "downloadSuccess",
    payment_required: "paymentTriggerCount",
    package_view: "packageViews",
    purchase_click: "purchaseClicks",
    support_click: "supportClicks",
    refund_request_created: "refundRequests",
    refund_processed: "refundProcessed"
  };
  const key = map[type];
  if (key) visitor[key] += 1;
}

function logEvent(req, res, type, meta = {}) {
  const visitor = getVisitor(req, res);
  return logVisitorEvent(visitor.id, type, meta, clientIp(req), req.headers["user-agent"] || "");
}

function logVisitorEvent(visitorId, type, meta = {}, ip = "", userAgent = "") {
  const visitor = analyticsState.visitors[visitorId];
  if (!visitor) return null;
  const event = {
    id: crypto.randomUUID(),
    type,
    visitorId: visitor.id,
    ip,
    userAgent,
    time: now(),
    ...meta
  };
  incrementVisitorCounter(visitor, type);
  analyticsState.events.push(event);
  if (analyticsState.events.length > MAX_EVENTS) {
    analyticsState.events.splice(0, analyticsState.events.length - MAX_EVENTS);
  }
  queuePersist();
  return event;
}

function logExceptionTask(kind, payload) {
  analyticsState.exceptionTasks.push({
    id: crypto.randomUUID(),
    kind,
    time: now(),
    ...payload
  });
  if (analyticsState.exceptionTasks.length > MAX_EXCEPTION_TASKS) {
    analyticsState.exceptionTasks.splice(0, analyticsState.exceptionTasks.length - MAX_EXCEPTION_TASKS);
  }
  queuePersist();
}

function findRefundRequest(refundId) {
  return analyticsState.refundRequests.find((item) => item.id === refundId);
}

function getVisitorUsage(visitor) {
  applyQuotaReset(visitor);
  const freeEnabled = settingsState.freeUsageEnabled;
  const freeLimit = freeEnabled ? settingsState.freeUsageLimit : Infinity;
  const freeRemaining = Number.isFinite(freeLimit) ? Math.max(0, freeLimit - visitor.quotaUsed) : null;
  const memberActive = visitor.memberUntil && visitor.memberUntil > now();
  return {
    freeRemaining,
    quotaUsed: visitor.quotaUsed,
    paidCredits: visitor.paidCredits || 0,
    memberActive
  };
}

function enabledPackages() {
  return settingsState.packages.filter((item) => item.enabled);
}

function enabledPaymentMethods() {
  return settingsState.paymentMethods.filter((item) => item.enabled);
}

function publicConfigForVisitor(visitor) {
  const usage = getVisitorUsage(visitor);
  return {
    siteName: settingsState.siteName,
    maxUploadMB: settingsState.maxUploadMB,
    cleanupMinutes: settingsState.cleanupMinutes,
    freeUsageEnabled: settingsState.freeUsageEnabled,
    freeUsageLimit: settingsState.freeUsageLimit,
    freeUsageResetMode: settingsState.freeUsageResetMode,
    billingEnabled: settingsState.billingEnabled,
    freeRemaining: usage.freeRemaining,
    paidCredits: usage.paidCredits,
    memberActive: usage.memberActive,
    packages: enabledPackages(),
    paymentMethods: enabledPaymentMethods(),
    supportEmail: settingsState.supportEmail,
    supportMessage: settingsState.supportMessage
  };
}

function paymentRequirementPayload(visitor) {
  return {
    paymentRequired: true,
    config: publicConfigForVisitor(visitor),
    code: "FREE_QUOTA_EXHAUSTED",
    message: "免费次数已用完，请购买后继续使用"
  };
}

function canUseService(visitor) {
  const usage = getVisitorUsage(visitor);
  if (usage.memberActive) return { allowed: true, chargeMode: "member" };
  if (!settingsState.freeUsageEnabled) return { allowed: true, chargeMode: "free" };
  if ((usage.freeRemaining ?? Infinity) > 0) return { allowed: true, chargeMode: "free" };
  if (usage.paidCredits > 0) return { allowed: true, chargeMode: "credit" };
  if (!settingsState.billingEnabled) return { allowed: true, chargeMode: "free" };
  return { allowed: false, chargeMode: "paywall" };
}

function consumeUsage(visitor, chargeMode) {
  if (chargeMode === "free") {
    visitor.quotaUsed += 1;
  } else if (chargeMode === "credit" && visitor.paidCredits > 0) {
    visitor.paidCredits -= 1;
  }
}

function restoreUsage(visitorId, chargeMode) {
  const visitor = analyticsState.visitors[visitorId];
  if (!visitor) return;
  if (chargeMode === "free" && visitor.quotaUsed > 0) {
    visitor.quotaUsed -= 1;
  } else if (chargeMode === "credit") {
    visitor.paidCredits = (visitor.paidCredits || 0) + 1;
  }
}

function getAdminSession(req) {
  const token = parseCookies(req)[ADMIN_COOKIE];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function requireAdmin(req, res) {
  const session = getAdminSession(req);
  if (!session) {
    sendError(res, 401, "ADMIN_UNAUTHORIZED", "请先登录后台。");
    return null;
  }
  return session;
}

function updateJob(job, patch) {
  Object.assign(job, patch);
  job.updatedAt = now();
  const data = `data: ${JSON.stringify({
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    resultBytes: job.resultBytes || null,
    originalBytes: job.originalBytes || null,
    targetBytes: job.targetBytes || null,
    downloadName: job.downloadName || null,
    downloadUrl: job.resultPath ? `/api/jobs/${job.id}/download` : null,
    downloadExpiresAt: job.expiresAt || null,
    ratio: job.ratio || null,
    hitTarget: typeof job.hitTarget === "boolean" ? job.hitTarget : null,
    error: job.error || null
  })}\n\n`;
  for (const client of job.clients) {
    client.write(data);
  }
}

async function ensureBinary(sourcePath, binaryPath) {
  const [srcStat, binStat] = await Promise.allSettled([fsp.stat(sourcePath), fsp.stat(binaryPath)]);
  const needsBuild =
    srcStat.status !== "fulfilled" ||
    binStat.status !== "fulfilled" ||
    srcStat.value.mtimeMs > binStat.value.mtimeMs;

  if (!needsBuild) return binaryPath;

  await new Promise((resolve, reject) => {
    const child = spawn("swiftc", [sourcePath, "-o", binaryPath], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `swiftc exited with code ${code}`));
    });
  });

  return binaryPath;
}

async function ensureBinaries() {
  await ensureDirectories();
  await Promise.all([
    ensureBinary(COMPRESS_SOURCE, COMPRESS_BINARY),
    ensureBinary(RASTER_SOURCE, RASTER_BINARY),
    ensureBinary(INSPECT_SOURCE, INSPECT_BINARY)
  ]);
}

function runWithTimeout(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killedByTimeout) {
        reject(buildError(504, "PROCESS_TIMEOUT", "文件处理超时，请稍后再试"));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || `process exited with code ${code}`));
    });
  });
}

async function inspectPdfFile(filePath) {
  await ensureBinaries();
  const { stdout } = await runWithTimeout(INSPECT_BINARY, [filePath], 15000);
  return JSON.parse(stdout);
}

async function runCompressionAttempt(inputPath, outputPath, params) {
  const timeoutMs = settingsState.compressionTimeoutSeconds * 1000;
  await runWithTimeout(COMPRESS_BINARY, [inputPath, outputPath, String(params.scale), String(params.quality)], timeoutMs);
  const stat = await fsp.stat(outputPath);
  return stat.size;
}

async function runRasterAttempt(inputPath, outputPath, params) {
  const timeoutMs = settingsState.compressionTimeoutSeconds * 1000;
  await runWithTimeout(
    RASTER_BINARY,
    [inputPath, outputPath, String(params.dpi), String(params.quality), params.grayscale ? "1" : "0"],
    timeoutMs
  );
  const stat = await fsp.stat(outputPath);
  return stat.size;
}

function interpolateParams(highFail, lowPass) {
  return {
    scale: Number(((highFail.scale + lowPass.scale) / 2).toFixed(4)),
    quality: Number(((highFail.quality + lowPass.quality) / 2).toFixed(4))
  };
}

function interpolateRasterParams(highFail, lowPass) {
  return {
    dpi: Math.max(6, Number(((highFail.dpi + lowPass.dpi) / 2).toFixed(2))),
    quality: Math.max(0.01, Number(((highFail.quality + lowPass.quality) / 2).toFixed(4))),
    grayscale: highFail.grayscale || lowPass.grayscale
  };
}

async function adaptiveCompress(job) {
  await ensureBinaries();
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), `pdf-compress-${job.id}-`));
  job.tmpDir = tmpDir;

  if (job.originalBytes <= job.targetBytes) {
    const passthrough = path.join(tmpDir, "passthrough.pdf");
    await fsp.copyFile(job.inputPath, passthrough);
    return { path: passthrough, bytes: job.originalBytes, scale: 1, quality: 1, hitTarget: true };
  }

  let bestPass = null;
  let lastFail = null;
  let smallestAttempt = null;
  const attempts = [];

  for (let index = 0; index < QUALITY_STEPS.length; index += 1) {
    const params = QUALITY_STEPS[index];
    const outputPath = path.join(tmpDir, `attempt-${index}.pdf`);
    updateJob(job, {
      status: "processing",
      progress: Math.min(0.16 + index * 0.07, 0.78),
      message: "正在压缩，请勿关闭页面"
    });
    const bytes = await runCompressionAttempt(job.inputPath, outputPath, params);
    const attempt = { ...params, bytes, path: outputPath };
    attempts.push(attempt);
    if (!smallestAttempt || bytes < smallestAttempt.bytes) {
      smallestAttempt = attempt;
    }
    if (bytes <= job.targetBytes) {
      bestPass = attempt;
      break;
    }
    lastFail = attempt;
  }

  if (!bestPass) {
    let rasterPass = null;
    let rasterFail = null;
    let rasterSmallest = smallestAttempt;

    for (let index = 0; index < RASTER_STEPS.length; index += 1) {
      const params = RASTER_STEPS[index];
      const outputPath = path.join(tmpDir, `raster-${index}.pdf`);
      updateJob(job, {
        status: "processing",
        progress: Math.min(0.8 + index * 0.012, 0.95),
        message: "正在执行深度压缩，清晰度可能下降"
      });
      const bytes = await runRasterAttempt(job.inputPath, outputPath, params);
      const attempt = { ...params, bytes, path: outputPath };
      if (!rasterSmallest || bytes < rasterSmallest.bytes) {
        rasterSmallest = attempt;
      }
      if (bytes <= job.targetBytes) {
        rasterPass = attempt;
        break;
      }
      rasterFail = attempt;
    }

    if (!rasterPass) {
      throw buildError(
        422,
        "TARGET_UNREACHABLE",
        `未能压缩到目标大小，当前文件较优结果约为 ${bytesToMB(rasterSmallest?.bytes || smallestAttempt?.bytes || job.originalBytes)}MB，请提高目标值后重试`,
        { bestAchievableBytes: rasterSmallest?.bytes || smallestAttempt?.bytes || job.originalBytes }
      );
    }

    if (!rasterFail) {
      return { ...rasterPass, hitTarget: true };
    }

    let currentRasterPass = rasterPass;
    let currentRasterFail = rasterFail;
    for (let round = 0; round < 4; round += 1) {
      const params = interpolateRasterParams(currentRasterFail, currentRasterPass);
      const outputPath = path.join(tmpDir, `raster-refine-${round}.pdf`);
      updateJob(job, {
        status: "processing",
        progress: 0.96 + round * 0.01,
        message: "正在执行深度压缩，清晰度可能下降"
      });
      const bytes = await runRasterAttempt(job.inputPath, outputPath, params);
      const attempt = { ...params, bytes, path: outputPath };
      if (bytes <= job.targetBytes) {
        currentRasterPass = attempt;
      } else {
        currentRasterFail = attempt;
      }
    }

    return { ...currentRasterPass, hitTarget: true };
  }

  if (!lastFail) {
    return { ...bestPass, hitTarget: true };
  }

  let currentPass = bestPass;
  let currentFail = lastFail;
  for (let round = 0; round < 3; round += 1) {
    const params = interpolateParams(currentFail, currentPass);
    const outputPath = path.join(tmpDir, `refine-${round}.pdf`);
    updateJob(job, {
      status: "processing",
      progress: 0.82 + round * 0.05,
      message: "正在压缩，请勿关闭页面"
    });
    const bytes = await runCompressionAttempt(job.inputPath, outputPath, params);
    const attempt = { ...params, bytes, path: outputPath };
    if (bytes <= job.targetBytes) {
      currentPass = attempt;
    } else {
      currentFail = attempt;
    }
  }

  return { ...currentPass, hitTarget: true };
}

function parseMultipart(buffer, boundary) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(boundaryBuffer);
  while (start !== -1) {
    const next = buffer.indexOf(boundaryBuffer, start + boundaryBuffer.length);
    if (next === -1) break;
    let part = buffer.slice(start + boundaryBuffer.length, next);
    if (part.slice(0, 2).toString() === "\r\n") part = part.slice(2);
    if (part.length === 0 || part.equals(Buffer.from("--\r\n"))) {
      start = next;
      continue;
    }
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) {
      start = next;
      continue;
    }
    const rawHeaders = part.slice(0, headerEnd).toString("utf8");
    const body = part.slice(headerEnd + 4);
    const headers = {};
    for (const line of rawHeaders.split("\r\n")) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
    parts.push({ headers, body });
    start = next;
  }
  return parts;
}

function parseContentDisposition(value = "") {
  const result = {};
  for (const segment of value.split(";")) {
    const [key, rawValue] = segment.trim().split("=");
    if (!rawValue) continue;
    result[key] = rawValue.replace(/^"|"$/g, "");
  }
  return result;
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  const maxBytes = settingsState.maxUploadMB * 1024 * 1024;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw buildError(413, "FILE_TOO_LARGE", `文件过大，当前最大支持 ${settingsState.maxUploadMB}MB`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  const raw = (await readBody(req)).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function validateTargetMB(rawValue, originalBytes) {
  const value = String(rawValue ?? "").trim();
  if (!value) return buildError(400, "TARGET_REQUIRED", "请输入目标文件大小");
  if (!/^\d+(\.\d+)?$/.test(value)) return buildError(400, "TARGET_NOT_NUMBER", "请输入有效数字");
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return buildError(400, "TARGET_NOT_NUMBER", "请输入有效数字");
  if (numeric <= 0) return buildError(400, "TARGET_NOT_POSITIVE", "目标大小必须大于 0");
  const originalMB = originalBytes / 1024 / 1024;
  if (numeric >= originalMB) return buildError(400, "TARGET_NOT_SMALLER", "目标大小需小于原文件大小");
  return null;
}

async function validateUploadedPdf(req, res, part) {
  if (!part || !part.disposition?.filename) {
    logEvent(req, res, "upload_failure", { message: "missing_file" });
    throw buildError(400, "FILE_EMPTY", "上传失败，请选择有效的 PDF 文件");
  }

  const originalName = sanitizeFileName(part.disposition.filename);
  if (path.extname(originalName).toLowerCase() !== ".pdf" || part.headers["content-type"]?.includes("pdf") === false) {
    logEvent(req, res, "upload_failure", { fileName: originalName, message: "invalid_type" });
    throw buildError(400, "FILE_TYPE_INVALID", "仅支持 PDF 文件，请重新上传");
  }

  if (!part.body || part.body.length === 0) {
    logEvent(req, res, "upload_failure", { fileName: originalName, message: "empty_body" });
    throw buildError(400, "FILE_EMPTY", "上传失败，请选择有效的 PDF 文件");
  }

  const magic = part.body.slice(0, 5).toString("utf8");
  if (!magic.startsWith("%PDF")) {
    logEvent(req, res, "upload_failure", { fileName: originalName, message: "bad_magic" });
    throw buildError(400, "FILE_TYPE_INVALID", "仅支持 PDF 文件，请重新上传");
  }

  return originalName;
}

async function preflightPdf(req, res, inputPath, originalName) {
  try {
    const inspection = await inspectPdfFile(inputPath);
    if (inspection.encrypted) {
      logEvent(req, res, "upload_failure", { fileName: originalName, message: "encrypted_pdf" });
      throw buildError(400, "PDF_ENCRYPTED", "该 PDF 可能已加密，暂不支持压缩");
    }
    if (!inspection.ok) {
      logEvent(req, res, "upload_failure", { fileName: originalName, message: "invalid_pdf" });
      throw buildError(400, "PDF_CORRUPTED", "当前文件无法处理，请更换 PDF 后重试");
    }
    return inspection;
  } catch (error) {
    if (error.code) throw error;
    logEvent(req, res, "upload_failure", { fileName: originalName, message: "inspect_failed" });
    throw buildError(400, "PDF_CORRUPTED", "当前文件无法处理，请更换 PDF 后重试");
  }
}

async function createJobFromRequest(req, res) {
  const visitor = getVisitor(req, res);
  const permission = canUseService(visitor);
  if (!permission.allowed) {
    logEvent(req, res, "payment_required", { message: "free_quota_exhausted" });
    throw buildError(402, "FREE_QUOTA_EXHAUSTED", "免费次数已用完，请购买后继续使用", paymentRequirementPayload(visitor));
  }

  const contentType = req.headers["content-type"] || "";
  const match = contentType.match(/boundary=(.+)$/);
  if (!match) {
    throw buildError(400, "MULTIPART_REQUIRED", "上传失败，请选择有效的 PDF 文件");
  }

  logEvent(req, res, "upload_click");
  let bodyBuffer;
  try {
    bodyBuffer = await readBody(req);
  } catch (error) {
    logEvent(req, res, "upload_failure", { message: error.message || "upload_failed" });
    throw error;
  }
  const parts = parseMultipart(bodyBuffer, match[1]);
  let pdfPart = null;
  let targetPart = null;
  for (const part of parts) {
    const disposition = parseContentDisposition(part.headers["content-disposition"]);
    if (disposition.name === "pdf") {
      pdfPart = { ...part, disposition };
    } else if (disposition.name === "targetMB") {
      targetPart = part;
    }
  }

  const originalName = await validateUploadedPdf(req, res, pdfPart);
  const targetError = validateTargetMB((targetPart?.body || Buffer.from("")).toString("utf8"), pdfPart.body.length);
  if (targetError) {
    throw targetError;
  }

  const targetMB = Number((targetPart?.body || Buffer.from("")).toString("utf8").trim());
  const jobId = crypto.randomUUID();
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), `pdf-upload-${jobId}-`));
  const inputPath = path.join(tmpDir, originalName);
  await fsp.writeFile(inputPath, pdfPart.body);
  await preflightPdf(req, res, inputPath, originalName);

  logEvent(req, res, "upload_success", { fileName: originalName, fileBytes: pdfPart.body.length });
  logEvent(req, res, "compress_start", { fileName: originalName, targetMB, fileBytes: pdfPart.body.length });
  consumeUsage(visitor, permission.chargeMode);

  const expiresAt = now() + settingsState.cleanupMinutes * 60 * 1000;
  const job = {
    id: jobId,
    status: "queued",
    progress: 0,
    message: "正在校验文件",
    createdAt: now(),
    updatedAt: now(),
    originalName,
    originalBytes: pdfPart.body.length,
    targetBytes: parseSizeToBytes(targetMB),
    inputPath,
    tmpDir,
    expiresAt,
    visitorId: visitor.id,
    chargeMode: permission.chargeMode,
    clients: []
  };
  jobs.set(jobId, job);
  queuePersist();
  runJob(job, req.headers["user-agent"] || "", clientIp(req));

  return {
    id: job.id,
    status: job.status,
    originalBytes: job.originalBytes,
    targetBytes: job.targetBytes,
    downloadUrl: `/api/jobs/${job.id}/download`,
    downloadExpiresAt: job.expiresAt,
    config: publicConfigForVisitor(visitor)
  };
}

async function runJob(job, userAgent, ip) {
  try {
    updateJob(job, {
      status: "processing",
      progress: 0.06,
      message: "正在校验文件"
    });
    const result = await adaptiveCompress(job);
    job.resultPath = result.path;
    job.resultBytes = result.bytes;
    job.hitTarget = result.hitTarget;
    job.downloadName = fileNameWithSuffix(job.originalName, "-compressed");
    job.ratio = job.originalBytes > 0 ? Number((1 - job.resultBytes / job.originalBytes).toFixed(4)) : 0;

    if (result.hitTarget) {
      logVisitorEvent(job.visitorId, "compress_success", {
        jobId: job.id,
        fileName: job.originalName,
        targetMB: bytesToMB(job.targetBytes),
        resultBytes: job.resultBytes
      }, ip, userAgent);
      updateJob(job, {
        status: "done",
        progress: 1,
        message: "压缩完成，可立即下载"
      });
      return;
    }
  } catch (error) {
    restoreUsage(job.visitorId, job.chargeMode);
    job.error = error.message;
    logExceptionTask("compress_failed", {
      jobId: job.id,
      fileName: job.originalName,
      message: error.message
    });
    logVisitorEvent(job.visitorId, "compress_failure", {
      jobId: job.id,
      fileName: job.originalName,
      message: error.message
    }, ip, userAgent);
    updateJob(job, {
      status: "error",
      progress: 1,
      message: error.code === "PROCESS_TIMEOUT" ? "压缩超时：文件处理超时，请稍后再试" : "压缩失败，请更换文件或稍后重试",
      error: error.message
    });
  }
}

async function serveStatic(req, res, reqPath) {
  const safePath = reqPath === "/" ? "/index.html" : reqPath;
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    notFound(res);
    return;
  }
  try {
    getVisitor(req, res);
    const data = await fsp.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    }[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0"
    });
    res.end(data);
  } catch {
    notFound(res);
  }
}

function sanitizePackagesInput(items) {
  return normalizePackages(items).slice(0, 20);
}

function sanitizePaymentMethodsInput(items) {
  return normalizePaymentMethods(items).slice(0, 10);
}

function adminPublicSettings() {
  return {
    siteName: settingsState.siteName,
    adminUsername: settingsState.adminUsername,
    maxUploadMB: settingsState.maxUploadMB,
    cleanupMinutes: settingsState.cleanupMinutes,
    compressionTimeoutSeconds: settingsState.compressionTimeoutSeconds,
    freeUsageEnabled: settingsState.freeUsageEnabled,
    freeUsageLimit: settingsState.freeUsageLimit,
    freeUsageResetMode: settingsState.freeUsageResetMode,
    billingEnabled: settingsState.billingEnabled,
    packages: settingsState.packages,
    paymentMethods: settingsState.paymentMethods,
    supportEmail: settingsState.supportEmail,
    supportMessage: settingsState.supportMessage
  };
}

function summarizeAnalytics() {
  const visitors = Object.values(analyticsState.visitors);
  const sum = (key) => visitors.reduce((acc, item) => acc + (Number(item[key]) || 0), 0);
  const compressSuccessCount = sum("compressSuccess");
  const compressPartialCount = sum("compressPartialSuccess");
  const compressFailCount = sum("compressFailure");
  const compressStartCount = sum("compressStarts");
  const successRate = compressStartCount === 0
    ? 0
    : Number((((compressSuccessCount + compressPartialCount) / compressStartCount) * 100).toFixed(2));
  return {
    pv: sum("pageVisits"),
    uv: visitors.length,
    uploadCount: sum("uploadSuccess"),
    uploadFailureCount: sum("uploadFailure"),
    compressCount: compressStartCount,
    compressSuccessCount,
    compressPartialCount,
    compressFailCount,
    successRate,
    downloadCount: sum("downloadSuccess"),
    paymentTriggerCount: sum("paymentTriggerCount"),
    packageViewCount: sum("packageViews"),
    purchaseClickCount: sum("purchaseClicks"),
    supportClickCount: sum("supportClicks"),
    refundRequestCount: analyticsState.refundRequests.length,
    refundProcessedCount: analyticsState.refundRequests.filter((item) => item.status === "refunded").length
  };
}

function buildAdminOverview() {
  const visitors = Object.values(analyticsState.visitors)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map((visitor) => ({
      ...visitor,
      firstSeenText: formatDateTime(visitor.firstSeenAt),
      lastSeenText: formatDateTime(visitor.lastSeenAt)
    }));
  const events = analyticsState.events
    .slice(-500)
    .reverse()
    .map((event) => ({ ...event, timeText: formatDateTime(event.time) }));
  const exceptionTasks = analyticsState.exceptionTasks
    .slice(-200)
    .reverse()
    .map((task) => ({ ...task, timeText: formatDateTime(task.time) }));
  const refundRequests = analyticsState.refundRequests
    .slice(-300)
    .reverse()
    .map((item) => ({
      ...item,
      createdAtText: formatDateTime(item.createdAt),
      refundedAtText: item.refundedAt ? formatDateTime(item.refundedAt) : null
    }));
  return {
    settings: adminPublicSettings(),
    summary: summarizeAnalytics(),
    visitors,
    events,
    exceptionTasks,
    refundRequests
  };
}

function buildExportWorkbookHtml() {
  const visitorRows = Object.values(analyticsState.visitors)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map((visitor) => `
      <tr>
        <td>${escapeHtml(visitor.id)}</td>
        <td>${escapeHtml(formatDateTime(visitor.firstSeenAt))}</td>
        <td>${escapeHtml(formatDateTime(visitor.lastSeenAt))}</td>
        <td>${escapeHtml(visitor.lastIp)}</td>
        <td>${escapeHtml(visitor.pageVisits)}</td>
        <td>${escapeHtml(visitor.uploadSuccess)}</td>
        <td>${escapeHtml(visitor.uploadFailure)}</td>
        <td>${escapeHtml(visitor.targetInputs)}</td>
        <td>${escapeHtml(visitor.compressStarts)}</td>
        <td>${escapeHtml(visitor.compressSuccess)}</td>
        <td>${escapeHtml(visitor.compressPartialSuccess)}</td>
        <td>${escapeHtml(visitor.compressFailure)}</td>
        <td>${escapeHtml(visitor.downloadClicks)}</td>
        <td>${escapeHtml(visitor.downloadSuccess)}</td>
        <td>${escapeHtml(visitor.paymentTriggerCount)}</td>
        <td>${escapeHtml(visitor.purchaseClicks)}</td>
        <td>${escapeHtml(visitor.supportClicks)}</td>
        <td>${escapeHtml(visitor.paidCredits)}</td>
      </tr>
    `)
    .join("");

  const eventRows = analyticsState.events
    .map((event) => `
      <tr>
        <td>${escapeHtml(event.visitorId)}</td>
        <td>${escapeHtml(event.type)}</td>
        <td>${escapeHtml(formatDateTime(event.time))}</td>
        <td>${escapeHtml(event.ip || "")}</td>
        <td>${escapeHtml(event.targetMB ?? "")}</td>
        <td>${escapeHtml(event.fileName || "")}</td>
        <td>${escapeHtml(event.fileBytes ?? "")}</td>
        <td>${escapeHtml(event.jobId || "")}</td>
        <td>${escapeHtml(event.message || "")}</td>
      </tr>
    `)
    .join("");

  const exceptionRows = analyticsState.exceptionTasks
    .map((task) => `
      <tr>
        <td>${escapeHtml(task.kind)}</td>
        <td>${escapeHtml(formatDateTime(task.time))}</td>
        <td>${escapeHtml(task.jobId || "")}</td>
        <td>${escapeHtml(task.fileName || "")}</td>
        <td>${escapeHtml(task.message || "")}</td>
      </tr>
    `)
    .join("");

  const refundRows = analyticsState.refundRequests
    .map((item) => `
      <tr>
        <td>${escapeHtml(item.id)}</td>
        <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
        <td>${escapeHtml(item.status)}</td>
        <td>${escapeHtml(item.contactEmail || "")}</td>
        <td>${escapeHtml(item.paymentAccount || "")}</td>
        <td>${escapeHtml(item.packageName || "")}</td>
        <td>${escapeHtml(item.amountCny ?? "")}</td>
        <td>${escapeHtml(item.adminNote || "")}</td>
      </tr>
    `)
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      table { border-collapse: collapse; margin-bottom: 24px; }
      th, td { border: 1px solid #999; padding: 6px 8px; font-size: 12px; }
      h2 { margin: 12px 0; }
    </style>
  </head>
  <body>
    <h2>Visitors</h2>
    <table>
      <thead><tr><th>visitor_id</th><th>first_seen</th><th>last_seen</th><th>ip</th><th>page_visits</th><th>upload_success</th><th>upload_failure</th><th>target_inputs</th><th>compress_starts</th><th>compress_success</th><th>compress_partial</th><th>compress_failure</th><th>download_clicks</th><th>download_success</th><th>payment_triggers</th><th>purchase_clicks</th><th>support_clicks</th><th>paid_credits</th></tr></thead>
      <tbody>${visitorRows}</tbody>
    </table>
    <h2>Events</h2>
    <table>
      <thead><tr><th>visitor_id</th><th>event_type</th><th>event_time</th><th>ip</th><th>target_mb</th><th>file_name</th><th>file_bytes</th><th>job_id</th><th>message</th></tr></thead>
      <tbody>${eventRows}</tbody>
    </table>
    <h2>ExceptionTasks</h2>
    <table>
      <thead><tr><th>kind</th><th>time</th><th>job_id</th><th>file_name</th><th>message</th></tr></thead>
      <tbody>${exceptionRows}</tbody>
    </table>
    <h2>RefundRequests</h2>
    <table>
      <thead><tr><th>refund_id</th><th>created_at</th><th>status</th><th>contact_email</th><th>payment_account</th><th>package_name</th><th>amount_cny</th><th>admin_note</th></tr></thead>
      <tbody>${refundRows}</tbody>
    </table>
  </body>
</html>`;
}

async function handleAdminLogin(req, res) {
  const body = await readJsonBody(req);
  if (
    body.username !== settingsState.adminUsername ||
    sha256(body.password || "") !== settingsState.adminPasswordHash
  ) {
    sendError(res, 401, "ADMIN_LOGIN_FAILED", "账号或密码错误。");
    return;
  }
  const token = crypto.randomUUID();
  sessions.set(token, {
    username: settingsState.adminUsername,
    createdAt: now(),
    expiresAt: now() + 12 * 60 * 60 * 1000
  });
  setCookie(res, ADMIN_COOKIE, token, { maxAge: 12 * 60 * 60, httpOnly: true });
  json(res, 200, { ok: true, username: settingsState.adminUsername });
}

async function handleAdminSettings(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;

  if (req.method === "GET") {
    json(res, 200, adminPublicSettings());
    return;
  }

  const body = await readJsonBody(req);
  const nextSettings = normalizeSettings({
    ...settingsState,
    siteName: String(body.siteName || settingsState.siteName).trim(),
    adminUsername: String(body.adminUsername || settingsState.adminUsername).trim(),
    maxUploadMB: body.maxUploadMB,
    cleanupMinutes: body.cleanupMinutes,
    compressionTimeoutSeconds: body.compressionTimeoutSeconds,
    freeUsageEnabled: body.freeUsageEnabled,
    freeUsageLimit: body.freeUsageLimit,
    freeUsageResetMode: body.freeUsageResetMode,
    billingEnabled: body.billingEnabled,
    packages: sanitizePackagesInput(body.packages),
    paymentMethods: sanitizePaymentMethodsInput(body.paymentMethods),
    supportEmail: String(body.supportEmail || "").trim(),
    supportMessage: String(body.supportMessage || "").trim()
  });

  if (!nextSettings.supportEmail) {
    sendError(res, 400, "SUPPORT_EMAIL_REQUIRED", "请填写客服邮箱。");
    return;
  }
  if (nextSettings.billingEnabled && nextSettings.packages.filter((item) => item.enabled).length === 0) {
    sendError(res, 400, "PACKAGE_REQUIRED", "开启收费后，至少保留一个启用中的套餐。");
    return;
  }
  if (body.newPassword && String(body.newPassword).trim()) {
    nextSettings.adminPasswordHash = sha256(String(body.newPassword).trim());
  }

  settingsState = nextSettings;
  await queuePersist();
  json(res, 200, { ok: true });
}

function findPackageById(packageId) {
  return settingsState.packages.find((item) => item.id === packageId && item.enabled);
}

async function handleManualUnlock(req, res) {
  const visitor = getVisitor(req, res);
  const body = await readJsonBody(req);
  const selected = findPackageById(body.packageId) || enabledPackages()[0];
  if (!selected) {
    sendError(res, 400, "PACKAGE_UNAVAILABLE", "当前购买服务暂不可用，请稍后再试");
    return;
  }

  if (selected.entitlementType === "credit_pack") {
    visitor.paidCredits += selected.entitlementValue;
  } else {
    const base = visitor.memberUntil && visitor.memberUntil > now() ? visitor.memberUntil : now();
    visitor.memberUntil = base + selected.entitlementValue * 24 * 60 * 60 * 1000;
  }

  logEvent(req, res, "purchase_click", {
    packageId: selected.id,
    message: "manual_unlock"
  });
  await queuePersist();
  json(res, 200, {
    ok: true,
    config: publicConfigForVisitor(visitor)
  });
}

async function handleRefundRequest(req, res) {
  const visitor = getVisitor(req, res);
  const body = await readJsonBody(req);
  const contactEmail = String(body.contactEmail || "").trim();
  const paymentAccount = String(body.paymentAccount || "").trim();
  const paymentName = String(body.paymentName || "").trim();
  const reason = String(body.reason || "").trim();
  const packageId = String(body.packageId || "").trim();
  const packageName = String(body.packageName || "").trim();
  const amountCny = body.amountCny === "" || body.amountCny == null ? null : Math.max(0, Number(body.amountCny) || 0);

  if (!contactEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
    sendError(res, 400, "REFUND_EMAIL_REQUIRED", "请填写可联系的邮箱地址。");
    return;
  }
  if (!paymentAccount) {
    sendError(res, 400, "REFUND_ACCOUNT_REQUIRED", "请填写退款接收账户。");
    return;
  }
  if (!reason) {
    sendError(res, 400, "REFUND_REASON_REQUIRED", "请填写退费原因。");
    return;
  }

  const refundRequest = {
    id: `refund_${Date.now()}`,
    visitorId: visitor.id,
    status: "pending",
    createdAt: now(),
    refundedAt: null,
    contactEmail,
    paymentAccount,
    paymentName,
    reason,
    packageId,
    packageName,
    amountCny,
    adminNote: ""
  };

  analyticsState.refundRequests.push(refundRequest);
  logEvent(req, res, "refund_request_created", {
    message: reason,
    packageId
  });
  await queuePersist();
  json(res, 200, {
    ok: true,
    refundId: refundRequest.id,
    message: "退费申请已提交，请等待人工处理。"
  });
}

async function handleAdminRefund(req, res, refundId) {
  const session = requireAdmin(req, res);
  if (!session) return;
  const refundRequest = findRefundRequest(refundId);
  if (!refundRequest) {
    sendError(res, 404, "REFUND_NOT_FOUND", "退费申请不存在。");
    return;
  }

  const body = await readJsonBody(req);
  refundRequest.status = "refunded";
  refundRequest.refundedAt = now();
  refundRequest.adminNote = String(body.adminNote || "").trim();
  if (body.paymentAccount) {
    refundRequest.paymentAccount = String(body.paymentAccount).trim();
  }

  logVisitorEvent(refundRequest.visitorId, "refund_processed", {
    message: refundRequest.adminNote || "manual_refund_processed"
  }, "", `admin:${session.username}`);
  await queuePersist();
  json(res, 200, {
    ok: true,
    refundRequest
  });
}

async function handleTracking(req, res) {
  const body = await readJsonBody(req);
  const type = String(body.type || "");
  const allowed = new Set([
    "page_visit",
    "upload_click",
    "upload_success",
    "upload_failure",
    "target_size_input",
    "download_click",
    "package_view",
    "purchase_click",
    "support_click"
  ]);
  if (!allowed.has(type)) {
    noContent(res);
    return;
  }
  logEvent(req, res, type, {
    targetMB: body.targetMB,
    fileName: body.fileName,
    fileBytes: body.fileBytes,
    jobId: body.jobId,
    message: body.message,
    packageId: body.packageId
  });
  noContent(res);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    const visitor = getVisitor(req, res);
    json(res, 200, publicConfigForVisitor(visitor));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/track") {
    await handleTracking(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/payments/manual-unlock") {
    await handleManualUnlock(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/refunds/request") {
    await handleRefundRequest(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/jobs") {
    try {
      const payload = await createJobFromRequest(req, res);
      json(res, 202, payload);
    } catch (error) {
      if (error.code) {
        sendError(res, error.status || 400, error.code, error.message, error.config ? { config: error.config, paymentRequired: true } : {});
        return;
      }
      logExceptionTask("create_job_failed", { message: error.message });
      sendError(res, 500, "SERVER_BUSY", "服务器繁忙，请稍后重试");
    }
    return;
  }

  const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (req.method === "GET" && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) {
      sendError(res, 404, "JOB_NOT_FOUND", "任务不存在或已过期");
      return;
    }
    json(res, 200, {
      id: job.id,
      status: job.status,
      progress: job.progress,
      message: job.message,
      originalBytes: job.originalBytes,
      targetBytes: job.targetBytes,
      resultBytes: job.resultBytes || null,
      ratio: job.ratio || null,
      hitTarget: typeof job.hitTarget === "boolean" ? job.hitTarget : null,
      downloadName: job.downloadName || null,
      downloadUrl: job.resultPath ? `/api/jobs/${job.id}/download` : null,
      downloadExpiresAt: job.expiresAt || null,
      error: job.error || null
    });
    return;
  }

  const eventsMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
  if (req.method === "GET" && eventsMatch) {
    const job = jobs.get(eventsMatch[1]);
    if (!job) {
      sendError(res, 404, "JOB_NOT_FOUND", "任务不存在或已过期");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    res.write("\n");
    job.clients.push(res);
    updateJob(job, {});
    req.on("close", () => {
      job.clients = job.clients.filter((client) => client !== res);
    });
    return;
  }

  const downloadMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/download$/);
  if (req.method === "GET" && downloadMatch) {
    const job = jobs.get(downloadMatch[1]);
    if (!job || !job.resultPath) {
      sendError(res, 404, "DOWNLOAD_NOT_FOUND", "下载失败，请重试");
      return;
    }
    if (job.expiresAt < now()) {
      sendError(res, 410, "DOWNLOAD_EXPIRED", "下载链接已过期，请重新压缩");
      return;
    }
    logEvent(req, res, "download_success", { jobId: job.id, fileName: job.downloadName });
    const stat = await fsp.stat(job.resultPath);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(job.downloadName || "compressed.pdf")}`
    });
    fs.createReadStream(job.resultPath).pipe(res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    await handleAdminLogin(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    const token = parseCookies(req)[ADMIN_COOKIE];
    if (token) sessions.delete(token);
    clearCookie(res, ADMIN_COOKIE);
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/session") {
    const session = getAdminSession(req);
    json(res, 200, { authenticated: Boolean(session), username: session?.username || null });
    return;
  }

  if (url.pathname === "/api/admin/settings") {
    await handleAdminSettings(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/overview") {
    const session = requireAdmin(req, res);
    if (!session) return;
    json(res, 200, buildAdminOverview());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/export") {
    const session = requireAdmin(req, res);
    if (!session) return;
    const workbook = buildExportWorkbookHtml();
    res.writeHead(200, {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": "attachment; filename*=UTF-8''pdf-compress-user-data.xls"
    });
    res.end(`\uFEFF${workbook}`);
    return;
  }

  const adminRefundMatch = url.pathname.match(/^\/api\/admin\/refunds\/([^/]+)\/refund$/);
  if (req.method === "POST" && adminRefundMatch) {
    await handleAdminRefund(req, res, adminRefundMatch[1]);
    return;
  }

  if (req.method === "GET") {
    // 保护后台页面，需要登录
    if (url.pathname === "/admin" || url.pathname === "/admin.html") {
      const session = getAdminSession(req);
      if (!session) {
        // 未登录，重定向到前台首页
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }
    }

    const routeMap = {
      "/admin": "/admin.html",
      "/privacy": "/privacy.html",
      "/terms": "/terms.html",
      "/contact": "/contact.html",
      "/faq": "/faq.html"
    };
    await serveStatic(req, res, routeMap[url.pathname] || url.pathname);
    return;
  }

  notFound(res);
}

async function cleanupExpiredJobs() {
  const current = now();
  for (const [id, job] of jobs.entries()) {
    if (job.expiresAt > current) continue;
    for (const client of job.clients) {
      client.end();
    }
    job.clients = [];
    for (const target of [job.inputPath, job.resultPath, job.tmpDir]) {
      if (!target) continue;
      try {
        await fsp.rm(target, { recursive: true, force: true });
      } catch {}
    }
    jobs.delete(id);
  }
}

function cleanupSessions() {
  const current = now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < current) sessions.delete(token);
  }
}

loadState()
  .then(async () => {
    await ensureBinaries();
    const server = http.createServer((req, res) => {
      handleRequest(req, res).catch((error) => {
        logExceptionTask("unhandled_request_error", { message: error.message });
        sendError(res, 500, "SERVER_BUSY", "服务器繁忙，请稍后重试");
      });
    });
    setInterval(() => {
      cleanupSessions();
      cleanupExpiredJobs().catch(() => {});
    }, 5 * 60 * 1000).unref();
    server.listen(PORT, HOST, () => {
      console.log(`PDF compress web app running at http://${HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
