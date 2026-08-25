const http = require("http");
const https = require("https");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");
const { URL } = require("url");
const { COMPRESS, searchBestConfig } = require("./lib/compress-search");
const { makeCompressedDownloadName } = require("./lib/download-name");
const { chooseAnalyticsFile } = require("./lib/analytics-path");
const {
  WEB_SESSION_MAX_AGE_MS,
  createWebSession,
  verifyWebSession,
  requestTokenFor,
  verifyRequestToken,
  isAutomatedUserAgent,
  isSameOriginRequest,
  createJobAccess,
  verifyJobAccess,
} = require("./lib/web-session");
const {
  appendAnalyticsEvent,
  readAnalyticsEvents,
  summarizeAnalytics,
  classifyFileName,
  normalizeRegion,
  normalizeUtm,
  normalizeLandingLanguage,
  exportAnalyticsCsv,
} = require("./lib/analytics");

// 启动时探测 Ghostscript 版本，暴露到 /api/config，便于线上确认实际运行的 gs 版本（部署验证用）。
let GS_VERSION = "unknown";
try { GS_VERSION = execFileSync("gs", ["--version"], { timeout: 5000 }).toString().trim(); } catch {}

const PORT = Number(process.env.PORT || 3487);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const ANALYTICS_FILE = chooseAnalyticsFile(process.env, ROOT);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const WEB_SESSION_SECRET = process.env.WEB_SESSION_SECRET || ADMIN_SESSION_SECRET;
const ADMIN_COOKIE = "tinypdf_admin";
const WEB_SESSION_COOKIE = "tinypdf_web_session";
const ADMIN_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_UPLOAD_MB    = 100;   // 硬上限：超出直接 413 拒绝（服务端强制，不可绕过）
// ── 运营配置（通过 Railway 环境变量控制，无需改代码）────────────────────────
// LARGE_FILE_MB         免费无摩擦阈值（默认 40）。超过此值的文件视为"大文件"：
//                       · 始终记录到 GA（评估大文件需求 / 是否值得升级服务器）
//                       · 当 AD_ENABLED=true 时需看广告解锁（前期未接广告时不拦截，仅记录）
// AD_ENABLED            是否启用广告门（默认 false）。false 时大文件照常免费压缩。
// MAX_INFLIGHT_UPLOADS  同时解析中的上传数上限（默认 2）。上传阶段会把整个文件读入内存，
//                       多个大文件并发会 OOM；超出立即 429 优雅排队。
const LARGE_FILE_MB        = Math.max(1, Number(process.env.LARGE_FILE_MB) || 40);
const AD_ENABLED_CFG       = process.env.AD_ENABLED === "true";
const AD_CLIENT_CFG        = process.env.AD_CLIENT || ""; // AdSense 发布商 ID (ca-pub-…)，过审后在 Railway 填
const AD_SLOT_CFG          = process.env.AD_SLOT || "";   // AdSense 广告单元 ID
const MAX_INFLIGHT_UPLOADS = Math.max(1, Number(process.env.MAX_INFLIGHT_UPLOADS) || 2);

// ── 服务端 GA4 Measurement Protocol ─────────────────────────────────────────
// 从 Railway（欧洲，不被墙）直连上报，绕开客户端 gtag / Cloudflare proxy / 中国网络的
// 所有不确定性。仅当配置了 GA_API_SECRET 时启用；未配置则静默跳过，不影响任何功能。
//   GA_MEASUREMENT_ID  GA4 衡量 ID（默认沿用页面里的 G-EGP898J99G）
//   GA_API_SECRET      GA4 后台 → 数据流 → Measurement Protocol API 密钥（在 Railway 环境变量里设置）
//   GA_MP_ENDPOINT     上报端点基址（默认官方；可改为自有代理，测试时指向本地 mock）
const GA_MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID || "G-EGP898J99G";
const GA_API_SECRET     = process.env.GA_API_SECRET || "";
const GA_MP_ENDPOINT    = process.env.GA_MP_ENDPOINT || "https://www.google-analytics.com";

// client_id 解析：优先复用客户端 gtag 的 _ga cookie（与客户端事件拼接），其次用我们自己
// 种的第一方 tinypdf_cid cookie。两者都没有则返回 null（由 ensureClientId 决定是否新种）。
function readClientId(req) {
  const cookie = (req && req.headers && req.headers.cookie) || "";
  const ga = cookie.match(/_ga=GA\d+\.\d+\.(\d+\.\d+)/);
  if (ga) return ga[1];
  const own = cookie.match(/(?:^|;\s*)tinypdf_cid=([\w.-]+)/);
  if (own) return own[1];
  return null;
}

function newClientId() {
  return `${Math.floor(Math.random() * 1e9)}.${Math.floor(Date.now() / 1000)}`;
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", cookie);
  } else if (Array.isArray(current)) {
    res.setHeader("Set-Cookie", [...current, cookie]);
  } else {
    res.setHeader("Set-Cookie", [current, cookie]);
  }
}

// 只读取 client_id（读不到给一个临时随机值，不持久化）。用于无法写 Set-Cookie 的场合。
function gaClientId(req) {
  return readClientId(req) || newClientId();
}

// 解析或分配稳定 client_id：新访客生成一个并种第一方 cookie（第一方、本域、国内不被墙，
// 同一浏览器从此稳定算作同一用户，修正国内无 _ga cookie 导致的用户数虚高）。
// 必须在 res.writeHead 之前调用。
function ensureClientId(req, res) {
  const existing = readClientId(req);
  if (existing) return existing;
  const id = newClientId();
  appendSetCookie(res, `tinypdf_cid=${id}; Path=/; Max-Age=63072000; SameSite=Lax; HttpOnly; Secure`);
  return id;
}

// 构造 GA4 事件载荷（纯函数，便于测试）。session_id + engagement_time_msec 为 GA4
// 报表正确归集活跃用户/会话所必需。
function gaEventPayload(clientId, name, params) {
  return {
    client_id: clientId || `${Math.floor(Math.random() * 1e9)}.${Math.floor(Date.now() / 1000)}`,
    events: [{
      name,
      params: {
        session_id: String(Math.floor(Date.now() / 1800000)), // 30 分钟会话桶
        engagement_time_msec: 100,
        ...params,
      },
    }],
  };
}

// 发送一个 GA4 事件（fire-and-forget：绝不阻塞主流程，出错只吞掉）。
function sendGaEvent(clientId, name, params) {
  if (!GA_API_SECRET) return;
  try {
    const u = new URL(GA_MP_ENDPOINT);
    const transport = u.protocol === "http:" ? http : https;
    const body = JSON.stringify(gaEventPayload(clientId, name, params));
    const reqOut = transport.request({
      method: "POST",
      hostname: u.hostname,
      port: u.port || undefined,
      path: `/mp/collect?measurement_id=${encodeURIComponent(GA_MEASUREMENT_ID)}&api_secret=${encodeURIComponent(GA_API_SECRET)}`,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    });
    reqOut.on("error", () => {});
    reqOut.write(body);
    reqOut.end();
  } catch {}
}

function parseCookies(req) {
  const out = {};
  const raw = (req && req.headers && req.headers.cookie) || "";
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function analyticsClientId(req) {
  return readClientId(req) || gaClientId(req);
}

function makeWebSessionCookie(req, value) {
  const host = req.headers.host || "";
  const secure = /(^|\.)tinypdf\.cn(?::\d+)?$/i.test(host) || req.headers["x-forwarded-proto"] === "https";
  return `${WEB_SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.floor(WEB_SESSION_MAX_AGE_MS / 1000)}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function webSessionContext(req) {
  const value = parseCookies(req)[WEB_SESSION_COOKIE] || "";
  return {
    value,
    claims: verifyWebSession(value, WEB_SESSION_SECRET),
  };
}

function validWebsiteRequest(req, requireRequestToken = false) {
  if (isAutomatedUserAgent(req.headers["user-agent"])) return null;
  const session = webSessionContext(req);
  if (!session.claims || !isSameOriginRequest(req)) return null;
  if (requireRequestToken && !verifyRequestToken(
    session.value,
    req.headers["x-tinypdf-web-token"],
    WEB_SESSION_SECRET
  )) return null;
  return session;
}

function rejectWebsiteSession(res) {
  sendError(
    res,
    403,
    "WEBSITE_SESSION_REQUIRED",
    "Open or refresh TinyPDF in your browser and try again."
  );
}

function visitorCountry(req) {
  return normalizeRegion(
    req.headers["cf-ipcountry"] ||
    req.headers["x-vercel-ip-country"] ||
    req.headers["cloudfront-viewer-country"] ||
    req.headers["fastly-client-country"] ||
    req.headers["x-appengine-country"] ||
    req.headers["x-country-code"] ||
    req.headers["x-forwarded-country"] ||
    ""
  );
}

function utmFromUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return normalizeUtm({
      source: parsed.searchParams.get("utm_source") || "",
      medium: parsed.searchParams.get("utm_medium") || "",
      campaign: parsed.searchParams.get("utm_campaign") || "",
      content: parsed.searchParams.get("utm_content") || "",
      term: parsed.searchParams.get("utm_term") || "",
    });
  } catch {
    return normalizeUtm({});
  }
}

function requestUtm(req, extra = {}) {
  const explicit = normalizeUtm(extra.utm || {});
  if (explicit.source || explicit.medium || explicit.campaign || explicit.content || explicit.term) return explicit;
  const referrer = extra.referrer != null ? extra.referrer : (req.headers.referer || req.headers.referrer || "");
  return utmFromUrl(referrer);
}

function requestMeta(req, url, extra = {}) {
  const ua = req.headers["user-agent"] || "";
  const browser =
    /Edg\//i.test(ua) ? "Edge" :
    /Chrome\//i.test(ua) ? "Chrome" :
    /Firefox\//i.test(ua) ? "Firefox" :
    /Safari\//i.test(ua) ? "Safari" : "Other";
  const device = /Mobi|Android|iPhone|iPad/i.test(ua) ? "mobile" : "desktop";
  return {
    sessionId: extra.sessionId || req.headers["x-tinypdf-session-id"] || "",
    clientId: extra.clientId || req.headers["x-tinypdf-client-id"] || analyticsClientId(req),
    path: url ? url.pathname : "",
    referrer: extra.referrer != null ? extra.referrer : (req.headers.referer || req.headers.referrer || ""),
    utm: requestUtm(req, extra),
    userAgent: ua,
    country: visitorCountry(req),
    device,
    browser,
    landingLanguage: normalizeLandingLanguage(extra.landingLanguage),
  };
}

function recordAnalytics(req, url, event, data = {}, extra = {}) {
  const payload = {
    event,
    ...requestMeta(req, url, extra),
    data,
  };
  appendAnalyticsEvent(ANALYTICS_FILE, payload).catch(() => {});
}

function signAdminSession(ts) {
  return crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(String(ts)).digest("hex");
}

function makeAdminCookie(req) {
  const ts = Date.now();
  const value = `${ts}.${signAdminSession(ts)}`;
  const host = req.headers.host || "";
  const secure = /tinypdf\.cn/i.test(host) || req.headers["x-forwarded-proto"] === "https";
  return `${ADMIN_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.floor(ADMIN_SESSION_MAX_AGE_MS / 1000)}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function clearAdminCookie() {
  return `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function hasValidAdminSession(req) {
  const value = parseCookies(req)[ADMIN_COOKIE];
  if (!value || !value.includes(".")) return false;
  const [tsRaw, sig] = value.split(".");
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || Date.now() - ts > ADMIN_SESSION_MAX_AGE_MS) return false;
  const expected = signAdminSession(tsRaw);
  const a = Buffer.from(sig || "");
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readJsonBody(req, maxBytes = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("JSON body too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

const jobs = new Map();
const eventStreams = new Map();
let inflightUploads = 0; // 正在解析中的上传数（内存保护用，见 MAX_INFLIGHT_UPLOADS）

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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── 检查 PDF 有效性和加密状态（读取文件头，无需外部进程）──────────────────
async function checkPdf(filePath) {
  const stat = await fsp.stat(filePath);
  const fd   = await fsp.open(filePath, "r");
  const headBuf = Buffer.alloc(8192);
  await fd.read(headBuf, 0, 8192, 0);
  // /Encrypt 在 PDF trailer 中，位于文件尾部，必须同时检查尾部
  const tailSize   = Math.min(8192, stat.size);
  const tailOffset = stat.size - tailSize;
  const tailBuf    = Buffer.alloc(tailSize);
  await fd.read(tailBuf, 0, tailSize, tailOffset);
  await fd.close();
  const header = headBuf.toString("latin1", 0, 5);
  if (header !== "%PDF-") return { valid: false, encrypted: false };
  const encrypted =
    headBuf.toString("latin1").includes("/Encrypt") ||
    tailBuf.toString("latin1").includes("/Encrypt");
  return { valid: true, encrypted };
}

// ── 强制栅格化压缩（无第三方依赖）─────────────────────────────────────────
// 矢量压缩（pdfwrite）无法达标时，把每页用 Ghostscript 渲染成 JPEG，再手工重组
// 为 PDF（DCTDecode 滤镜，不重新编码），通过自适应 DPI/质量搜索保证压到目标大小。
// 代价：矢量文字变成像素图（可能模糊），仅作为最后兜底手段。

// 解析 JPEG 的 SOF 标记，取出宽 / 高 / 通道数
function parseJpegDims(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG");
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    let marker = buf[i + 1];
    while (marker === 0xff && i + 1 < buf.length) { i++; marker = buf[i + 1]; }
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), components: buf[i + 9] };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error("JPEG SOF marker not found");
}

// 把多张 JPEG（每页一张）手工组装成 PDF（每张 JPEG 作为 DCTDecode 图像 XObject）
function buildPdfFromJpegs(jpegBufs, dpi) {
  const chunks = [];
  let offset = 0;
  const objOffsets = {};
  const push = (b) => { chunks.push(b); offset += b.length; };
  push(Buffer.from("%PDF-1.4\n%\xff\xff\xff\xff\n", "latin1"));

  const numPages = jpegBufs.length;
  let objId = 3; // 1 = Catalog, 2 = Pages
  const perPage = [];
  const pageObjIds = [];
  for (let p = 0; p < numPages; p++) {
    const imgId = objId++, contentId = objId++, pageId = objId++;
    perPage.push({ imgId, contentId, pageId });
    pageObjIds.push(pageId);
  }
  const writeObj = (id, body) => {
    objOffsets[id] = offset;
    push(Buffer.concat([Buffer.from(`${id} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]));
  };
  writeObj(1, Buffer.from(`<< /Type /Catalog /Pages 2 0 R >>`, "latin1"));
  writeObj(2, Buffer.from(`<< /Type /Pages /Count ${numPages} /Kids [${pageObjIds.map(id => `${id} 0 R`).join(" ")}] >>`, "latin1"));

  for (let p = 0; p < numPages; p++) {
    const jpeg = jpegBufs[p];
    const { width, height, components } = parseJpegDims(jpeg);
    const cs = components === 1 ? "/DeviceGray" : components === 4 ? "/DeviceCMYK" : "/DeviceRGB";
    const { imgId, contentId, pageId } = perPage[p];
    const wPt = (width / dpi) * 72, hPt = (height / dpi) * 72;

    objOffsets[imgId] = offset;
    push(Buffer.from(`${imgId} 0 obj\n`, "latin1"));
    push(Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, "latin1"));
    push(jpeg);
    push(Buffer.from("\nendstream\nendobj\n", "latin1"));

    const content = `q\n${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`;
    const contentBuf = Buffer.from(content, "latin1");
    writeObj(contentId, Buffer.concat([Buffer.from(`<< /Length ${contentBuf.length} >>\nstream\n`, "latin1"), contentBuf, Buffer.from("endstream", "latin1")]));
    writeObj(pageId, Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt.toFixed(2)} ${hPt.toFixed(2)}] /Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>`, "latin1"));
  }

  const totalObjs = objId;
  const xrefOffset = offset;
  let xrefStr = `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
  for (let id = 1; id < totalObjs; id++) xrefStr += `${String(objOffsets[id] || 0).padStart(10, "0")} 00000 n \n`;
  push(Buffer.from(xrefStr, "latin1"));
  push(Buffer.from(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, "latin1"));
  return Buffer.concat(chunks);
}

// 用 Ghostscript 把 PDF 每页渲染成 JPEG → 重组为 PDF，返回 PDF Buffer
async function rasterizeToJpegPdf(inputPath, dpi, quality) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tinypdf-raster-"));
  try {
    const pattern = path.join(tmpDir, "p-%04d.jpg");
    await new Promise((resolve, reject) => {
      const proc = spawn("gs", [
        "-sDEVICE=jpeg", `-r${dpi}`, `-dJPEGQ=${quality}`,
        "-dNOPAUSE", "-dBATCH", "-dQUIET", `-sOutputFile=${pattern}`, inputPath,
      ]);
      const err = [];
      proc.stderr.on("data", (d) => err.push(d));
      proc.on("close", (c) => c === 0 ? resolve() : reject(new Error(`gs jpeg exited ${c}: ${Buffer.concat(err).toString().slice(0, 200)}`)));
    });
    const files = (await fsp.readdir(tmpDir)).filter(f => /^p-\d+\.jpg$/.test(f)).sort();
    if (files.length === 0) throw new Error("rasterize produced no pages");
    const bufs = [];
    for (const f of files) bufs.push(await fsp.readFile(path.join(tmpDir, f)));
    return buildPdfFromJpegs(bufs, dpi);
  } finally {
    try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// 探测 + 对数-对数 DPI 搜索 + 质量阶梯 + 绝对地板。
// 自高到低搜索，第一个 <= 目标的结果即返回（达标前提下画质最好）。
// 若目标物理上不可达，返回能产出的最小结果（尽力而为，绝不返回原文件）。
async function forceRasterToTarget(jobId, job, inputPath, targetBytes) {
  const PROBE_DPI = 72, PROBE_Q = 45, DPI_FLOOR = 8;
  const pts = [];          // {dpi, bytes} 用于对数-对数拟合
  let smallest = null;     // 目标不可达时的兜底（最小结果）
  let step = 0;
  const announce = () => {
    job.state.progress = Math.min(0.97, 0.85 + step * 0.02);
    job.state.message  = "Applying stronger compression";
    sendEvent(jobId, job.state);
    step++;
  };
  const tryPass = async (d, qq) => {
    try {
      const p = await rasterizeToJpegPdf(inputPath, d, qq);
      if (p && p.length >= 64) { if (!smallest || p.length < smallest.length) smallest = p; return p; }
    } catch {}
    return null;
  };

  // 探测：若连探测都失败，说明该文件无法栅格化，抛错交由上层回退
  announce();
  let dpi = PROBE_DPI, q = PROBE_Q;
  let pdf = await tryPass(dpi, q);
  if (!pdf) throw new Error("Rasterization failed");
  pts.push({ dpi, bytes: pdf.length });
  if (pdf.length <= targetBytes) return pdf;

  // DPI 搜索（探测质量不变；自高到低，第一个达标即最佳画质）
  for (let attempt = 0; attempt < 5 && dpi > DPI_FLOOR; attempt++) {
    let next;
    if (pts.length < 2) {
      next = dpi * Math.sqrt(targetBytes / pdf.length);        // 单点 → 假设 size ∝ dpi²
    } else {
      const a = pts[pts.length - 2], b = pts[pts.length - 1];  // 两点对数-对数求局部指数
      const n = Math.log(a.bytes / b.bytes) / Math.log(a.dpi / b.dpi);
      const nn = (!isFinite(n) || n < 0.5) ? 2 : n;
      next = b.dpi * Math.pow(targetBytes / b.bytes, 1 / nn);
    }
    let nextDpi = Math.max(DPI_FLOOR, Math.floor(next * 0.97));
    if (nextDpi >= dpi) nextDpi = Math.max(DPI_FLOOR, dpi - 4); // 保证每轮都在下降
    dpi = nextDpi;
    announce();
    const got = await tryPass(dpi, q);
    if (!got) break;
    pdf = got;
    pts.push({ dpi, bytes: pdf.length });
    if (pdf.length <= targetBytes) return pdf;
  }

  // 已到 DPI 地板仍超标 → 在地板上降质量（大步收敛）
  for (const q2 of [30, 18, 10]) {
    announce();
    const got = await tryPass(DPI_FLOOR, q2);
    if (got && got.length <= targetBytes) return got;
  }

  // 绝对地板：能产出的最小结果
  announce();
  const got = await tryPass(6, 8);
  if (got && got.length <= targetBytes) return got;

  return smallest; // 物理不可达 → 尽力而为的最小结果
}

// 矢量保真的连续质量旋钮：pdfwrite + 关闭 JPEG 直通 + 强制 DCT 重编码 + 自定义 QFactor。
// QFactor 越小画质越高、体积越大（与体积近似幂律关系），可平滑命中任意目标体积，
// 且文字/矢量保持清晰（不栅格化）。resCap 限制图像分辨率上限（默认 300，超过才下采样）。
async function runGsQf(inputPath, outputPath, qf, resCap) {
  return new Promise((resolve, reject) => {
    const ps =
      `<< /ColorImageDict << /QFactor ${qf} /Blend 1 /HSamples [2 1 1 2] /VSamples [2 1 1 2] >> ` +
      `/GrayImageDict << /QFactor ${qf} /Blend 1 /HSamples [2 1 1 2] /VSamples [2 1 1 2] >> >> setdistillerparams`;
    const args = [
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.5",
      // 注意：不要用 -dPDFSETTINGS=/prepress。某些 Ghostscript 版本（如 Debian Bookworm 的 10.0.0）
      // 会让该预设覆盖下面 setdistillerparams 设的自定义 QFactor，导致质量旋钮失效、体积坍缩到默认值。
      // 显式设置所需各项参数，跨版本稳健（本地 10.03.1 实测：有无该预设结果完全一致）。
      "-dEmbedAllFonts=true", "-dSubsetFonts=true",
      "-dNOPAUSE", "-dBATCH", "-dQUIET",
      "-dPassThroughJPEGImages=false",
      "-dAutoFilterColorImages=false", "-dColorImageFilter=/DCTEncode",
      "-dAutoFilterGrayImages=false", "-dGrayImageFilter=/DCTEncode",
      "-dDownsampleColorImages=true", `-dColorImageResolution=${resCap}`,
      "-dDownsampleGrayImages=true", `-dGrayImageResolution=${resCap}`,
      `-dColorImageDownsampleThreshold=${COMPRESS.DOWNSAMPLE_THRESHOLD}`,
      `-dGrayImageDownsampleThreshold=${COMPRESS.DOWNSAMPLE_THRESHOLD}`,
      `-sOutputFile=${outputPath}`,
      "-c", ps, "-f", inputPath,
    ];
    const proc = spawn("gs", args);
    const errChunks = [];
    proc.stderr.on("data", (d) => errChunks.push(d));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gs qf exited ${code}: ${Buffer.concat(errChunks).toString("utf8").slice(0, 200)}`));
    });
  });
}

// 分辨率优先的矢量压缩搜索：构造真实 Ghostscript probe，交由纯函数 searchBestConfig 选最优
// (分辨率,质量) 配置。probe 即用即删探测临时文件，返回字节数或 null。
// 返回 { qf, resCap, bytes }(≤target) 或 null（交由栅格化兜底）。不落地最终文件，由调用方按配置渲染。
async function vectorCompressSearch(jobId, job, inputPath, scratchBase, targetBytes, minValidBytes) {
  let step = 0;
  const scratch = `${scratchBase}.probe.tmp`;
  const probe = async (qf, resCap) => {
    job.state.progress = Math.min(0.8, 0.12 + step * 0.05);
    job.state.message  = "Searching for the clearest version that fits the target size...";
    sendEvent(jobId, job.state);
    step++;
    try { await runGsQf(inputPath, scratch, qf, resCap); }
    catch { try { fs.unlinkSync(scratch); } catch {} return null; }
    let st; try { st = await fsp.stat(scratch); } catch { return null; }
    try { fs.unlinkSync(scratch); } catch {}
    if (st.size < minValidBytes) return null;
    return st.size;
  };
  return await searchBestConfig(probe, targetBytes, COMPRESS);
}

function generateJobId() {
  return crypto.randomBytes(12).toString("hex");
}

// ── 安全响应头 ──────────────────────────────────────────────────────────────
function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // 广告启用时放行 Google 广告域名（否则 AdSense JS 被自身 CSP 挡掉）；关闭时维持严格策略。
  const adScript = AD_ENABLED_CFG
    ? " https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.google.com https://*.googleadservices.com https://adservice.google.com"
    : "";
  const adFrame = AD_ENABLED_CFG
    ? " https://*.googlesyndication.com https://*.google.com https://*.doubleclick.net"
    : "";
  const adImg = AD_ENABLED_CFG ? " https:" : "";
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'${adScript}; style-src 'self' 'unsafe-inline'; ` +
    `img-src 'self' data:${adImg}; frame-src 'self'${adFrame}; connect-src 'self'${adScript}; ` +
    `object-src 'none'; frame-ancestors 'none'`
  );
}

// ── 最大并发任务数（防止内存/磁盘 DoS）────────────────────────────────────
const MAX_CONCURRENT_JOBS = 5;

function sendEvent(jobId, state) {
  const streams = eventStreams.get(jobId) || [];
  const data = JSON.stringify(state);
  for (const res of streams) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch {}
  }
}

function cleanupJob(jobId) {
  const job = jobs.get(jobId);
  if (job) {
    try { fs.unlinkSync(job.inputPath); } catch {}
    try { fs.unlinkSync(job.outputPath); } catch {}
    // 删除可能泄漏的探测临时文件
    try { fs.unlinkSync(`${job.outputPath}.probe.tmp`); } catch {}
  }
  jobs.delete(jobId);
  eventStreams.delete(jobId);
}

async function compressPdf(jobId, inputPath, targetBytes, originalName) {
  const job = jobs.get(jobId);
  if (!job) return;

  const outputPath = job.outputPath;
  const downloadName = makeCompressedDownloadName(originalName);
  const targetMB = Number((targetBytes / 1048576).toFixed(2));

  try {
    // ── 校验 PDF ──────────────────────────────────────────────────────────
    const [pdfInfo, inputStat] = await Promise.all([
      checkPdf(inputPath),
      fsp.stat(inputPath)
    ]);
    const originalBytes = inputStat.size;

    if (!pdfInfo.valid)     throw new Error("This is not a valid PDF file");
    if (pdfInfo.encrypted)  throw new Error("Encrypted PDFs are not supported. Please unlock the file and try again.");

    // 输出是否有效不能由“相对原文件大小”判断：有些 PDF 含大量冗余数据，
    // 合法压缩结果可能远小于原文件的 1%。保留一个固定的损坏文件防线即可。
    const MIN_VALID_BYTES = 1024;

    job.state.originalBytes = originalBytes;
    job.state.targetBytes   = targetBytes;
    job.state.progress      = 0.1;
    job.state.message       = "Starting compression";
    sendEvent(jobId, job.state);

    let resultBytes    = null;
    let ratio          = null;
    let bestValidPath  = null;
    let bestValidBytes = Infinity;

    // ── 原文件已不大于目标：无需压缩，原文件即最清晰结果 ──────────────────
    if (originalBytes <= targetBytes) {
      await fsp.copyFile(inputPath, outputPath);
      resultBytes = originalBytes;
      ratio       = 1;
    }

    // ── 主压缩：分辨率优先搜索（保住原生分辨率，质量为辅；目标内最清晰，矢量不栅格化）──
    if (resultBytes === null) {
      try {
        const cfg = await vectorCompressSearch(jobId, job, inputPath, outputPath, targetBytes, MIN_VALID_BYTES);
        if (cfg) {
          await runGsQf(inputPath, outputPath, cfg.qf, cfg.resCap); // 用选定配置渲染最终输出
          const st = await fsp.stat(outputPath);
          if (st.size <= targetBytes && st.size >= MIN_VALID_BYTES) {
            resultBytes    = st.size;
            ratio          = resultBytes / originalBytes;
            bestValidPath  = outputPath;
            bestValidBytes = resultBytes;
          }
        }
      } catch {
        // 搜索/渲染失败 → 交由栅格化兜底
      }
    }

    // ── 兜底：矢量重编码到不了目标（最低画质仍超标）→ 强制栅格化 ──────────
    // 每页渲染成 JPEG 再无依赖重组为 PDF。矢量文字会变成像素图（可能模糊），但保证达标。
    // 仅在 QFactor 搜索未达标时触发。
    if (resultBytes === null || resultBytes > targetBytes) {
      try {
        const rasterPdf = await forceRasterToTarget(jobId, job, inputPath, targetBytes);
        if (rasterPdf && rasterPdf.length >= MIN_VALID_BYTES) {
          await fsp.writeFile(outputPath, rasterPdf);
          resultBytes    = rasterPdf.length;
          ratio          = resultBytes / originalBytes;
          bestValidPath  = outputPath;
          bestValidBytes = resultBytes;
          job.state.rasterized = true; // 标记已栅格化 → 前端显示清晰度提示
        }
      } catch {
        // 栅格化失败 → 保留已有 bestValid，由下方兜底处理
      }
    }

    // ── 最终兜底：目标无法达到时返回最小有效结果 ─────────────────────────
    if (resultBytes === null && bestValidPath && bestValidBytes < Infinity) {
      if (bestValidPath !== outputPath) {
        await fsp.rename(bestValidPath, outputPath);
      }
      resultBytes = bestValidBytes;
      ratio       = resultBytes / originalBytes;
    }

    // ── 防止结果比原文件更大（边界情况：极小已压缩 PDF）─────────────────
    // 仅在最终结果仍大于原文件时回退到原文件
    if (resultBytes !== null && resultBytes >= originalBytes) {
      await fsp.copyFile(inputPath, outputPath);
      resultBytes = originalBytes;
      ratio       = 1;
    }

    if (resultBytes === null) throw new Error("Compression failed. Please try again.");

    const reachedTarget    = resultBytes <= targetBytes;
    const noCompressNeeded = resultBytes >= originalBytes; // 已回退原文件：目标 ≥ 原文件
    job.state.progress     = 1;
    job.state.status       = "done";
    job.state.message      = noCompressNeeded
      ? "The original file is already no larger than the target size"
      : reachedTarget
        ? "Compression complete"
        : "The file has limited room for compression. This is the smallest usable result we could produce.";
    job.state.resultBytes  = resultBytes;
    job.state.ratio        = ratio;
    job.state.downloadName = downloadName;
    sendEvent(jobId, job.state);

    // 服务端 GA 上报：压缩完成（真实用户行为，最可靠的业务数据）
    sendGaEvent(job.gaClientId, "compress_complete", {
      original_mb:    bytesToMB(originalBytes),
      target_mb:      bytesToMB(targetBytes),
      result_mb:      bytesToMB(resultBytes),
      ratio:          Number((ratio || 0).toFixed(3)),
      reached_target: reachedTarget ? 1 : 0,
      rasterized:     job.state.rasterized ? 1 : 0,
    });
    appendAnalyticsEvent(ANALYTICS_FILE, {
      event: "compress_success",
      ...(job.analyticsMeta || {}),
      data: {
        fileName: job.originalName,
        fileCategory: classifyFileName(job.originalName),
        originalBytes,
        targetMB,
        targetBytes,
        resultBytes,
        ratio: Number((ratio || 0).toFixed(3)),
        reachedTarget,
        rasterized: Boolean(job.state.rasterized),
      },
    }).catch(() => {});

  } catch (error) {
    job.state.status   = "error";
    job.state.progress = 1;
    job.state.message  = "Compression failed";
    job.state.error    = error.message;
    sendEvent(jobId, job.state);
    sendGaEvent(job.gaClientId, "compress_error", { reason: String(error.message).slice(0, 100) });
    appendAnalyticsEvent(ANALYTICS_FILE, {
      event: "compress_error",
      ...(job.analyticsMeta || {}),
      data: {
        fileName: job.originalName,
        fileCategory: classifyFileName(job.originalName),
        reason: String(error.message).slice(0, 160),
      },
    }).catch(() => {});
  }
}

async function handleMultipart(req, boundary, maxSize) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    chunks.push(chunk);
    totalBytes += chunk.length;
    if (totalBytes > maxSize) throw new Error("file too large");
  }
  const buffer = Buffer.concat(chunks);
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts = [];
  let offset = 0;
  while (offset < buffer.length) {
    const idx = buffer.indexOf(boundaryBuf, offset);
    if (idx === -1) break;
    const nextIdx = buffer.indexOf(boundaryBuf, idx + boundaryBuf.length);
    if (nextIdx === -1) break;
    const part = buffer.slice(idx + boundaryBuf.length + 2, nextIdx - 2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString("utf8");
      const content = part.slice(headerEnd + 4);
      const nameMatch = headers.match(/name="([^"]+)"/);
      const filenameMatch = headers.match(/filename="([^"]+)"/);
      parts.push({
        name: nameMatch ? nameMatch[1] : null,
        filename: filenameMatch ? filenameMatch[1] : null,
        content
      });
    }
    offset = nextIdx;
  }
  return parts;
}

async function handleApiRequest(req, res, url) {
  if (url.pathname === "/api/config" && req.method === "GET") {
    let session = webSessionContext(req);
    let sessionCookie = "";
    // A page can stay open longer than the two-hour website-session lifetime.
    // Renew the session only for a same-origin browser fetch so an expired token
    // can recover without making the user re-select the PDF or exposing a token
    // to crawlers/cross-site callers.
    if (
      !session.claims &&
      !isAutomatedUserAgent(req.headers["user-agent"]) &&
      isSameOriginRequest(req)
    ) {
      const renewed = createWebSession(WEB_SESSION_SECRET, {
        referrer: req.headers.referer || req.headers.referrer || "",
        utm: requestUtm(req),
      });
      session = renewed;
      sessionCookie = makeWebSessionCookie(req, renewed.value);
    }
    json(res, 200, {
      largeFileMB: LARGE_FILE_MB,
      adsEnabled:  AD_ENABLED_CFG,
      adClient:    AD_CLIENT_CFG,
      adSlot:      AD_SLOT_CFG,
      maxUploadMB: MAX_UPLOAD_MB,
      gsVersion:   GS_VERSION,
      webRequestToken: session.claims && !isAutomatedUserAgent(req.headers["user-agent"])
        ? requestTokenFor(session.value, WEB_SESSION_SECRET)
        : "",
    }, sessionCookie ? { "Set-Cookie": sessionCookie } : {});
    return;
  }

  if (url.pathname === "/api/track" && req.method === "POST") {
    const session = webSessionContext(req);
    if (isAutomatedUserAgent(req.headers["user-agent"]) || !session.claims) {
      setSecurityHeaders(res);
      res.writeHead(204, {
        "X-Robots-Tag": "noindex, nofollow, noarchive",
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }
    try {
      const body = await readJsonBody(req);
      const eventName = String(body.event || "").trim();
      if (!eventName || eventName.length > 80) {
        sendError(res, 400, "BAD_REQUEST", "Invalid event");
        return;
      }
      await appendAnalyticsEvent(ANALYTICS_FILE, {
        event: eventName,
        ...requestMeta(req, url, {
          sessionId: body.sessionId || "",
          clientId: body.clientId || analyticsClientId(req),
          referrer: session.claims.attribution.referrer,
          utm: session.claims.attribution.utm,
          landingLanguage: body.landingLanguage || (body.data && body.data.landingLanguage),
        }),
        data: body.data || {},
      });
      json(res, 200, { ok: true });
    } catch {
      sendError(res, 400, "BAD_REQUEST", "Invalid tracking payload");
    }
    return;
  }

  if (url.pathname === "/api/admin/login" && req.method === "POST") {
    if (!ADMIN_PASSWORD) {
      sendError(res, 503, "ADMIN_DISABLED", "Admin login is not configured");
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendError(res, 400, "BAD_REQUEST", "Invalid login payload");
      return;
    }
    if (String(body.password || "") !== ADMIN_PASSWORD) {
      sendError(res, 401, "UNAUTHORIZED", "Invalid password");
      return;
    }
    json(res, 200, { ok: true }, { "Set-Cookie": makeAdminCookie(req) });
    return;
  }

  if (url.pathname === "/api/admin/logout" && req.method === "POST") {
    json(res, 200, { ok: true }, { "Set-Cookie": clearAdminCookie() });
    return;
  }

  if (url.pathname === "/api/admin/summary" && req.method === "GET") {
    if (!ADMIN_PASSWORD || !hasValidAdminSession(req)) {
      sendError(res, 401, "UNAUTHORIZED", "Admin login required");
      return;
    }
    const events = await readAnalyticsEvents(ANALYTICS_FILE);
    json(res, 200, summarizeAnalytics(events), { "Cache-Control": "no-store" });
    return;
  }

  if (url.pathname === "/api/admin/export" && req.method === "GET") {
    if (!ADMIN_PASSWORD || !hasValidAdminSession(req)) {
      sendError(res, 401, "UNAUTHORIZED", "Admin login required");
      return;
    }
    const range = ["1m", "3m", "5m", "all"].includes(url.searchParams.get("range"))
      ? url.searchParams.get("range")
      : "all";
    const events = await readAnalyticsEvents(ANALYTICS_FILE);
    const csv = exportAnalyticsCsv(events, range);
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tinypdf-analytics-${range}.csv"`,
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(csv),
    });
    res.end(csv);
    return;
  }

  if (url.pathname === "/api/jobs" && req.method === "POST") {
    const websiteSession = validWebsiteRequest(req, true);
    if (!websiteSession) {
      rejectWebsiteSession(res);
      return;
    }
    const contentType = req.headers["content-type"] || "";
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      sendError(res, 400, "BAD_REQUEST", "Invalid request");
      return;
    }

    // 在途上传内存保护：上传阶段会把整个文件读入内存，且发生在并发任务校验之前；
    // 多个大文件同时上传会顶爆内存（OOM）。这里单独限制同时解析中的上传数，超出立即 429。
    if (inflightUploads >= MAX_INFLIGHT_UPLOADS) {
      sendError(res, 429, "TOO_BUSY", "The server is busy. Please try again later.");
      return;
    }
    inflightUploads++;
    try {
      let parts;
      try {
        parts = await handleMultipart(req, boundaryMatch[1], MAX_UPLOAD_MB * 1024 * 1024);
      } catch (e) {
        if (e.message === "file too large") {
          sendError(res, 413, "FILE_TOO_LARGE", `File is too large. The maximum supported size is ${MAX_UPLOAD_MB}MB`);
        } else {
          sendError(res, 400, "BAD_REQUEST", "Upload parsing failed. Please try again.");
        }
        return;
      }
      const pdfPart = parts.find(p => p.name === "pdf");
      const targetMBPart = parts.find(p => p.name === "targetMB");
      const formField = name => {
        const part = parts.find(p => p.name === name);
        return part ? part.content.toString("utf8") : "";
      };

      if (!pdfPart || !pdfPart.filename || !targetMBPart) {
        sendError(res, 400, "BAD_REQUEST", "Please choose a PDF file and enter a target size");
        return;
      }

      const targetMB = parseFloat(targetMBPart.content.toString("utf8"));
      if (!Number.isFinite(targetMB) || targetMB <= 0) {
        sendError(res, 400, "BAD_REQUEST", "Please enter a valid target size");
        return;
      }

      // PDF 魔数校验：拒绝非 PDF 内容（防止任意文件上传）
      if (!pdfPart.content.slice(0, 5).equals(Buffer.from("%PDF-"))) {
        sendError(res, 400, "INVALID_FILE", "Please upload a valid PDF file");
        return;
      }

      // 并发任务数限制（防内存/磁盘 DoS）
      const activeJobs = [...jobs.values()].filter(j => j.state.status === "processing").length;
      if (activeJobs >= MAX_CONCURRENT_JOBS) {
        sendError(res, 429, "TOO_BUSY", "The server is busy. Please try again later.");
        return;
      }

      const jobId = generateJobId();
      const inputPath = path.join(os.tmpdir(), `pdf-compress-${jobId}-input.pdf`);
      const outputPath = path.join(os.tmpdir(), `pdf-compress-${jobId}-output.pdf`);
      const uploadBytes = pdfPart.content.length;
      const clientId = gaClientId(req);
      const analyticsMeta = requestMeta(req, url, {
        landingLanguage: formField("landingLanguage"),
        referrer: websiteSession.claims.attribution.referrer,
        utm: websiteSession.claims.attribution.utm,
      });
      const jobAccess = createJobAccess(websiteSession.claims);

      await fsp.writeFile(inputPath, pdfPart.content);

      // 服务端记录每次上传的大小：从服务器直发 GA，不受客户端网络/cookie 影响，size 维度可靠。
      // 用于后期评估"大文件需求是否足够多 → 是否值得花钱升级服务器 / 上付费档"。
      const sizeMB  = uploadBytes / 1048576;
      const isLarge = sizeMB > LARGE_FILE_MB;
      sendGaEvent(clientId, "pdf_upload", {
        size_mb: Math.round(sizeMB * 10) / 10,
        size_bucket: !isLarge ? `0-${LARGE_FILE_MB}` : (sizeMB <= 75 ? `${LARGE_FILE_MB}-75` : "75-100"),
        is_large: isLarge ? 1 : 0,
        target_mb: targetMB,
        ads_enabled: AD_ENABLED_CFG ? 1 : 0
      });
      appendAnalyticsEvent(ANALYTICS_FILE, {
        event: "file_selected",
        ...analyticsMeta,
        data: {
          fileName: pdfPart.filename,
          fileCategory: classifyFileName(pdfPart.filename),
          fileBytes: uploadBytes,
        },
      }).catch(() => {});
      appendAnalyticsEvent(ANALYTICS_FILE, {
        event: "compress_started",
        ...analyticsMeta,
        data: {
          fileName: pdfPart.filename,
          fileCategory: classifyFileName(pdfPart.filename),
          fileBytes: uploadBytes,
          targetMB,
          targetBytes: parseSizeToBytes(targetMB),
        },
      }).catch(() => {});

      const job = {
        id: jobId,
        inputPath,
        outputPath,
        originalName: pdfPart.filename,
        analyticsMeta,
        ...jobAccess,
        targetBytes: parseSizeToBytes(targetMB),
        targetMB,
        state: {
          id: jobId,
          status: "processing",
          progress: 0.05,
          message: "File uploaded",
          originalBytes: uploadBytes,
          targetMB,
          targetBytes: parseSizeToBytes(targetMB),
          resultBytes: null,
          ratio: null
        }
      };

      job.gaClientId = clientId; // 服务端 GA 上报用，复用客户端 _ga cookie

      jobs.set(jobId, job);
      eventStreams.set(jobId, []);

      setTimeout(() => compressPdf(jobId, inputPath, parseSizeToBytes(targetMB), pdfPart.filename), 0);
      setTimeout(() => cleanupJob(jobId), 60 * 60 * 1000);

      json(res, 200, {
        ...job.state,
        accessToken: job.accessToken,
        config: {
          siteName: "TinyPDF",
          maxUploadMB: MAX_UPLOAD_MB
        }
      });
    } finally {
      inflightUploads--; // 解析+写盘完成，大缓冲随本次请求作用域结束被 GC
    }
    return;
  }

  if (url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/events")) {
    const jobId = url.pathname.slice("/api/jobs/".length, -"/events".length);
    const job = jobs.get(jobId);
    if (!job) {
      sendError(res, 404, "NOT_FOUND", "Job not found");
      return;
    }
    const websiteSession = validWebsiteRequest(req);
    if (!websiteSession || !verifyJobAccess(job, websiteSession.claims, url.searchParams.get("access"))) {
      sendError(res, 403, "JOB_ACCESS_DENIED", "This job is not available in the current website session.");
      return;
    }

    setSecurityHeaders(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    });

    const streams = eventStreams.get(jobId) || [];
    streams.push(res);
    eventStreams.set(jobId, streams);

    if (job) {
      res.write(`data: ${JSON.stringify(job.state)}\n\n`);
    }

    req.on("close", () => {
      const current = eventStreams.get(jobId) || [];
      eventStreams.set(jobId, current.filter(r => r !== res));
    });
    return;
  }

  if (url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/download")) {
    const jobId = url.pathname.slice("/api/jobs/".length, -"/download".length);
    const job = jobs.get(jobId);
    if (!job || job.state.status !== "done") {
      sendError(res, 404, "NOT_FOUND", "File not found");
      return;
    }
    const websiteSession = validWebsiteRequest(req);
    if (!websiteSession || !verifyJobAccess(job, websiteSession.claims, url.searchParams.get("access"))) {
      sendError(res, 403, "JOB_ACCESS_DENIED", "This job is not available in the current website session.");
      return;
    }

    let stat;
    try {
      stat = await fsp.stat(job.outputPath);
    } catch {
      sendError(res, 404, "NOT_FOUND", "The file has expired. Please compress it again.");
      return;
    }
    const safeName = job.state.downloadName || "compressed.pdf";
    const encodedName = encodeURIComponent(safeName);
    appendAnalyticsEvent(ANALYTICS_FILE, {
      event: "download_clicked",
      ...(job.analyticsMeta || {}),
      data: {
        fileName: job.originalName,
        fileCategory: classifyFileName(job.originalName),
        originalBytes: job.state.originalBytes || "",
        targetMB: job.targetMB || "",
        targetBytes: job.state.targetBytes || job.targetBytes || "",
        resultBytes: job.state.resultBytes || stat.size,
      },
    }).catch(() => {});
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": stat.size,
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      // RFC 6266 / RFC 5987：filename* 支持非 ASCII，filename 做 ASCII 兜底
      "Content-Disposition": `attachment; filename="compressed.pdf"; filename*=UTF-8''${encodedName}`
    });
    const readStream = fs.createReadStream(job.outputPath);
    readStream.pipe(res);
    return;
  }

  sendError(res, 404, "NOT_FOUND", "API endpoint not found");
}

function json(res, statusCode, payload, extraHeaders = {}) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, code, message, extra = {}) {
  json(res, statusCode, { code, message, ...extra });
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".pdf": "application/pdf"
};

// 判定是否真实浏览器的页面导航（过滤健康检查/爬虫/预取，减少 page_view 噪声与用户数虚高）。
function isRealBrowser(req) {
  const ua = req.headers["user-agent"] || "";
  if (!/Mozilla|Chrome|Safari|Firefox|Edg/i.test(ua)) return false;
  if (isAutomatedUserAgent(ua)) return false;
  // 必须是真实浏览器的顶层页面导航：现代浏览器导航都带 Sec-Fetch-Mode=navigate；
  // 爬虫/扫描器/健康检查/Cloudflare 探测/预取多半不带这些头——借此过滤掉它们造成的活跃用户虚高。
  if (req.headers["sec-fetch-mode"] !== "navigate") return false;
  const dest = req.headers["sec-fetch-dest"];
  if (dest && dest !== "document") return false;
  const purpose = req.headers["sec-purpose"] || req.headers["purpose"] || "";
  if (/prefetch|prerender/i.test(purpose)) return false;
  return true;
}

async function handleStatic(req, res, url) {
  const legacyRedirects = new Map([
    ["/en", "/"],
    ["/en/", "/"],
    ["/en/index.html", "/"],
    ["/en/faq", "/faq"],
    ["/en/faq.html", "/faq"],
  ]);
  if (legacyRedirects.has(url.pathname)) {
    setSecurityHeaders(res);
    res.writeHead(301, { Location: legacyRedirects.get(url.pathname) });
    res.end();
    return;
  }

  let pathname = url.pathname;
  if (pathname === "/") pathname = "/index.html";
  else if (pathname === "/zh" || pathname === "/zh/") pathname = "/zh/index.html";
  // 无扩展名路径（如 /terms /privacy /contact /faq）回退到对应 .html，使无后缀链接可访问。
  else if (!path.extname(pathname)) pathname += ".html";
  const filePath = path.join(PUBLIC_DIR, pathname);

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error("not file");

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    setSecurityHeaders(res);

    // 真实浏览器访问首页：在写响应头之前解析/分配稳定 client_id（新访客种第一方 cookie），
    // 供服务端 page_view 上报使用，修正国内用户因无 _ga cookie 每次被算作新用户的问题。
    let pageViewCid = null;
    if ((pathname === "/index.html" || pathname === "/zh/index.html") && isRealBrowser(req)) {
      pageViewCid = ensureClientId(req, res);
      const session = createWebSession(WEB_SESSION_SECRET, {
        referrer: req.headers.referer || req.headers.referrer || "",
        utm: utmFromUrl(`http://${req.headers.host || "tinypdf.cn"}${url.pathname}${url.search}`),
      });
      appendSetCookie(res, makeWebSessionCookie(req, session.value));
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size
    });

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);

    // 服务端 page_view（客户端 gtag 在国内常被墙，这是主数据来源）
    if (pageViewCid) {
      sendGaEvent(pageViewCid, "page_view", {
        page_location: `https://${req.headers.host || "tinypdf.cn"}${url.pathname}`,
        page_title: "TinyPDF",
      });
    }
  } catch {
    sendError(res, 404, "NOT_FOUND", "Page not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApiRequest(req, res, url);
    } else {
      await handleStatic(req, res, url);
    }
  } catch (error) {
    console.error(error);
    sendError(res, 500, "INTERNAL_ERROR", "Server error");
  }
});

async function main() {
  server.listen(PORT, HOST, () => {
    console.log(`TinyPDF running at http://${HOST}:${PORT}`);
  });
}

main().catch(console.error);
