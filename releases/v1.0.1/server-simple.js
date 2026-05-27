const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { URL } = require("url");

const sqlite = require("sqlite");
const sqlite3 = require("sqlite3");

// Load .env file manually (no dotenv dependency needed)
try {
  const envContent = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && val && !process.env[key]) process.env[key] = val;
  }
} catch {}

// Optional Resend email integration
let resendClient = null;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || "TinyPDF <noreply@resend.dev>";
if (RESEND_API_KEY && !RESEND_API_KEY.startsWith("your_")) {
  try {
    const { Resend } = require("resend");
    resendClient = new Resend(RESEND_API_KEY);
    console.log("[email] Resend initialized");
  } catch (e) {
    console.warn("[email] Failed to load resend:", e.message);
  }
}

const PORT = Number(process.env.PORT || 3487);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : path.join(ROOT, "data");
const DB_PATH = process.env.DB_PATH || path.join(ROOT, "data", "simple-points.sqlite");

const INITIAL_POINTS = 10;
const POINTS_PER_COMPRESS = 10;
let db = null;

// Ghostscript compression steps: progressively lower image DPI + JPEG quality
const GS_QUALITY_STEPS = [
  { dpi: 200, jpegQ: 92 },
  { dpi: 180, jpegQ: 88 },
  { dpi: 160, jpegQ: 84 },
  { dpi: 144, jpegQ: 80 },
  { dpi: 128, jpegQ: 76 },
  { dpi: 112, jpegQ: 72 },
  { dpi: 96,  jpegQ: 68 },
  { dpi: 84,  jpegQ: 64 },
  { dpi: 72,  jpegQ: 58 },
  { dpi: 60,  jpegQ: 52 },
  { dpi: 48,  jpegQ: 45 },
  { dpi: 36,  jpegQ: 38 },
  { dpi: 24,  jpegQ: 30 },
  { dpi: 18,  jpegQ: 22 },
];

// Deep compression: convert to grayscale at very low DPI
const GS_RASTER_STEPS = [
  { dpi: 48, jpegQ: 40, grayscale: false },
  { dpi: 36, jpegQ: 30, grayscale: false },
  { dpi: 24, jpegQ: 25, grayscale: true },
  { dpi: 18, jpegQ: 20, grayscale: true },
  { dpi: 12, jpegQ: 15, grayscale: true },
  { dpi: 8,  jpegQ: 10, grayscale: true },
];

const sessions = new Map();
const userCache = new Map();
const jobs = new Map();
const eventStreams = new Map();
const otpStore = new Map(); // email → {code, expires}

async function initDb() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  db = await sqlite.open({ filename: DB_PATH, driver: sqlite3.Database });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      device_id TEXT UNIQUE NOT NULL,
      points INTEGER NOT NULL DEFAULT ${INITIAL_POINTS},
      created_at INTEGER NOT NULL,
      last_login INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS redeem_codes (
      code TEXT PRIMARY KEY,
      points INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      used_by TEXT,
      used_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);

    CREATE TABLE IF NOT EXISTS ad_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      slot_id TEXT NOT NULL DEFAULT 'slot_reward',
      points_granted INTEGER NOT NULL DEFAULT 10,
      watch_seconds INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ad_rewards_user_date
      ON ad_rewards(user_id, created_at);
  `);

  // migration: add email column if not present
  try { await db.exec("ALTER TABLE users ADD COLUMN email TEXT"); } catch {}
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function authenticate(req) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;

  if (Date.now() - session.createdAt > 7 * 24 * 60 * 60 * 1000) {
    sessions.delete(token);
    return null;
  }

  return session;
}

async function getOrCreateUser(deviceId) {
  let user = await db.get("SELECT * FROM users WHERE device_id = ?", [deviceId]);

  if (!user) {
    const userId = crypto.randomBytes(16).toString("hex");
    const now = Date.now();
    await db.run(
      "INSERT INTO users (id, device_id, points, created_at, last_login) VALUES (?, ?, ?, ?, ?)",
      [userId, deviceId, INITIAL_POINTS, now, now]
    );
    await db.run(
      "INSERT INTO transactions (user_id, type, amount, description, created_at) VALUES (?, ?, ?, ?, ?)",
      [userId, "gift", INITIAL_POINTS, "新用户赠送", now]
    );
    user = await db.get("SELECT * FROM users WHERE id = ?", [userId]);
  }

  return user;
}

async function consumePoints(session, amount = POINTS_PER_COMPRESS) {
  if (session.points < amount) {
    return { success: false, message: "积分不足" };
  }

  const newPoints = session.points - amount;

  await db.run("UPDATE users SET points = ? WHERE id = ?", [newPoints, session.userId]);
  await db.run(
    "INSERT INTO transactions (user_id, type, amount, description, created_at) VALUES (?, ?, ?, ?, ?)",
    [session.userId, "compression", amount, "PDF压缩消耗", Date.now()]
  );

  session.points = newPoints;
  return { success: true, points: newPoints };
}

async function addPoints(session, amount, description = "积分充值") {
  const newPoints = session.points + amount;
  await db.run("UPDATE users SET points = ? WHERE id = ?", [newPoints, session.userId]);
  await db.run(
    "INSERT INTO transactions (user_id, type, amount, description, created_at) VALUES (?, ?, ?, ?, ?)",
    [session.userId, "add", amount, description, Date.now()]
  );

  session.points = newPoints;
  return { success: true, points: newPoints };
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

async function checkGhostscript() {
  return new Promise((resolve) => {
    const proc = spawn("gs", ["--version"]);
    proc.on("close", (code) => {
      if (code === 0) { console.log("[gs] Ghostscript ready"); resolve(); }
      else { console.error("[gs] Ghostscript not found — install ghostscript"); resolve(); }
    });
    proc.on("error", () => { console.error("[gs] Ghostscript not found"); resolve(); });
  });
}

function generateJobId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

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
  }
  jobs.delete(jobId);
  eventStreams.delete(jobId);
}

function runGs(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("gs", args);
    const stderr = [];
    proc.stderr.on("data", (d) => stderr.push(d));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gs exited ${code}: ${Buffer.concat(stderr).toString("utf8").slice(0, 200)}`));
    });
    proc.on("error", reject);
  });
}

function gsArgs(inputPath, outputPath, dpi, jpegQ, grayscale) {
  const args = [
    "-sDEVICE=pdfwrite", "-dNOPAUSE", "-dBATCH", "-dQUIET",
    "-dCompatibilityLevel=1.4",
    "-dDownsampleColorImages=true", "-dColorImageDownsampleType=/Bicubic", `-dColorImageResolution=${dpi}`,
    "-dDownsampleGrayImages=true", "-dGrayImageDownsampleType=/Bicubic",  `-dGrayImageResolution=${dpi}`,
    "-dDownsampleMonoImages=true", `-dMonoImageResolution=${dpi}`,
    "-dAutoFilterColorImages=false", "-dAutoFilterGrayImages=false",
    "-dColorImageFilter=/DCTEncode", "-dGrayImageFilter=/DCTEncode",
    `-dJPEGQ=${jpegQ}`,
    `-sOutputFile=${outputPath}`,
    inputPath
  ];
  if (grayscale) {
    args.splice(1, 0, "-sColorConversionStrategy=Gray", "-dProcessColorModel=/DeviceGray");
  }
  return args;
}

async function compressPdf(jobId, inputPath, targetBytes, originalName) {
  const job = jobs.get(jobId);
  if (!job) return;

  const outputPath = job.outputPath;
  const downloadName = fileNameWithSuffix(sanitizeFileName(originalName), ".compressed");

  try {
    const originalBytes = (await fsp.stat(inputPath)).size;

    job.state.originalBytes = originalBytes;
    job.state.targetBytes = targetBytes;
    job.state.progress = 0.1;
    job.state.message = "开始压缩";
    sendEvent(jobId, job.state);

    let resultBytes = null;
    let ratio = null;
    let lastOutput = null;
    let rasterMode = false;

    // Phase 1: progressive quality reduction
    for (let i = 0; i < GS_QUALITY_STEPS.length; i++) {
      const step = GS_QUALITY_STEPS[i];
      job.state.progress = 0.1 + (i / GS_QUALITY_STEPS.length) * 0.6;
      job.state.message = `压缩中 (${i + 1}/${GS_QUALITY_STEPS.length})`;
      sendEvent(jobId, job.state);

      const tmpOut = `${outputPath}.${i}.tmp`;
      try {
        await runGs(gsArgs(inputPath, tmpOut, step.dpi, step.jpegQ, false));
        const stat = await fsp.stat(tmpOut);
        if (stat.size <= targetBytes) {
          await fsp.rename(tmpOut, outputPath);
          resultBytes = stat.size;
          ratio = resultBytes / originalBytes;
          lastOutput = outputPath;
          break;
        } else {
          if (lastOutput && lastOutput !== inputPath && lastOutput !== outputPath) {
            try { fs.unlinkSync(lastOutput); } catch {}
          }
          lastOutput = tmpOut;
        }
      } catch {
        try { fs.unlinkSync(tmpOut); } catch {}
      }
    }

    // Phase 2: deep compression (low DPI, optionally grayscale)
    if (!resultBytes) {
      rasterMode = true;
      const srcForRaster = lastOutput || inputPath;
      for (let i = 0; i < GS_RASTER_STEPS.length; i++) {
        const step = GS_RASTER_STEPS[i];
        job.state.progress = 0.7 + (i / GS_RASTER_STEPS.length) * 0.25;
        job.state.message = `深度优化中 (${i + 1}/${GS_RASTER_STEPS.length})`;
        sendEvent(jobId, job.state);

        const tmpOut = `${outputPath}.r${i}.tmp`;
        try {
          await runGs(gsArgs(srcForRaster, tmpOut, step.dpi, step.jpegQ, step.grayscale));
          const stat = await fsp.stat(tmpOut);
          if (stat.size <= targetBytes || i === GS_RASTER_STEPS.length - 1) {
            await fsp.rename(tmpOut, outputPath);
            resultBytes = stat.size;
            ratio = resultBytes / originalBytes;
            try { if (srcForRaster !== inputPath) fs.unlinkSync(srcForRaster); } catch {}
            break;
          }
          try { fs.unlinkSync(tmpOut); } catch {}
        } catch {
          try { fs.unlinkSync(tmpOut); } catch {}
        }
      }
    }

    if (!resultBytes) {
      throw new Error("压缩失败，请重试");
    }

    job.state.progress = 1;
    job.state.status = "done";
    job.state.message = "压缩完成";
    job.state.resultBytes = resultBytes;
    job.state.ratio = ratio;
    job.state.downloadName = downloadName;
    job.state.rasterMode = rasterMode;
    sendEvent(jobId, job.state);

  } catch (error) {
    job.state.status = "error";
    job.state.progress = 1;
    job.state.message = "压缩失败";
    job.state.error = error.message;
    sendEvent(jobId, job.state);

    // Refund points on compression failure
    if (job.session) {
      try {
        await addPoints(job.session, POINTS_PER_COMPRESS, "压缩失败退款");
      } catch (refundErr) {
        console.error("[refund] failed to refund points:", refundErr.message);
      }
    }
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
    json(res, 200, {
      siteName: "TinyPDF",
      maxUploadMB: 250,
      initialPoints: INITIAL_POINTS,
      pointsPerCompress: POINTS_PER_COMPRESS,
      adProvider: "mock"
    });
    return;
  }

  if (url.pathname === "/api/auth/anonymous" && req.method === "POST") {
    const body = await parseJson(req);
    const deviceId = body?.deviceId || crypto.randomBytes(16).toString("hex");

    const user = await getOrCreateUser(deviceId);
    const token = generateToken();
    sessions.set(token, {
      userId: user.id,
      deviceId,
      points: user.points,
      email: user.email || null,
      createdAt: Date.now()
    });

    json(res, 200, {
      token,
      user: {
        id: user.id,
        points: user.points,
        email: user.email || null,
        deviceId: user.device_id
      }
    });
    return;
  }

  if (url.pathname === "/api/points" && req.method === "GET") {
    const session = await authenticate(req);
    if (!session) {
      sendError(res, 401, "UNAUTHORIZED", "请先登录");
      return;
    }

    json(res, 200, { points: session.points });
    return;
  }

  if (url.pathname === "/api/points/add" && req.method === "POST") {
    const session = await authenticate(req);
    if (!session) {
      sendError(res, 401, "UNAUTHORIZED", "请先登录");
      return;
    }

    const body = await parseJson(req);
    const amount = parseInt(body?.amount || 10, 10);
    const result = await addPoints(session, amount, body?.description);

    json(res, 200, result);
    return;
  }

  if (url.pathname === "/api/track" && req.method === "POST") {
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/ads/reward" && req.method === "POST") {
    const session = await authenticate(req);
    if (!session) {
      sendError(res, 401, "UNAUTHORIZED", "请先登录");
      return;
    }

    const body = await parseJson(req);

    // Fix 1: Use parseInt to prevent NaN bypass (Number("abc") === NaN, NaN < 10 is false)
    const watchSeconds = parseInt(body?.watch_seconds, 10);
    if (isNaN(watchSeconds) || watchSeconds < 10) {
      sendError(res, 400, "WATCH_TOO_SHORT", "观看时间不足");
      return;
    }

    // Fix 4: Allowlist slot_id to prevent arbitrary values
    const VALID_SLOT_IDS = new Set(["slot_reward"]);
    const rawSlotId = body?.slot_id;
    const slotId = VALID_SLOT_IDS.has(rawSlotId) ? rawSlotId : "slot_reward";

    // Fix 2+3: Wrap check-and-act in a SQLite IMMEDIATE transaction to prevent
    // TOCTOU race; INSERT audit record before addPoints so no orphaned points on failure.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartTs = todayStart.getTime();

    await db.run("BEGIN IMMEDIATE");
    try {
      const todayCount = await db.get(
        "SELECT COUNT(*) as cnt FROM ad_rewards WHERE user_id = ? AND created_at >= ?",
        [session.userId, todayStartTs]
      );

      if (todayCount.cnt >= 10) {
        await db.run("ROLLBACK");
        sendError(res, 429, "REWARD_LIMIT_EXCEEDED", "今日领取次数已达上限（10次）");
        return;
      }

      const REWARD_POINTS = 10;
      const now = Date.now();

      // INSERT first (audit trail), then addPoints
      await db.run(
        "INSERT INTO ad_rewards (user_id, slot_id, points_granted, watch_seconds, created_at) VALUES (?, ?, ?, ?, ?)",
        [session.userId, slotId, REWARD_POINTS, watchSeconds, now]
      );

      const result = await addPoints(session, REWARD_POINTS, "激励广告奖励");

      await db.run("COMMIT");

      json(res, 200, {
        success: true,
        points_added: REWARD_POINTS,
        new_balance: result.points
      });
    } catch (err) {
      try { await db.run("ROLLBACK"); } catch {}
      throw err;
    }
    return;
  }

  if (url.pathname === "/api/jobs" && req.method === "POST") {
    let session = await authenticate(req);
    let newToken = null;

    if (!session) {
      // Auto-create anonymous session so compression always works
      const deviceId = crypto.randomBytes(16).toString("hex");
      const user = await getOrCreateUser(deviceId);
      newToken = generateToken();
      session = { userId: user.id, deviceId, points: user.points, email: null, createdAt: Date.now() };
      sessions.set(newToken, session);
    }

    const consumeResult = await consumePoints(session);
    if (!consumeResult.success) {
      sendError(res, 402, "INSUFFICIENT_POINTS", consumeResult.message);
      return;
    }
    const contentType = req.headers["content-type"] || "";
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      sendError(res, 400, "BAD_REQUEST", "无效的请求");
      return;
    }

    const parts = await handleMultipart(req, boundaryMatch[1], 250 * 1024 * 1024);
    const pdfPart = parts.find(p => p.name === "pdf");
    const targetMBPart = parts.find(p => p.name === "targetMB");

    if (!pdfPart || !pdfPart.filename || !targetMBPart) {
      sendError(res, 400, "BAD_REQUEST", "请选择PDF文件并输入目标大小");
      return;
    }

    const targetMB = parseFloat(targetMBPart.content.toString("utf8"));
    if (!Number.isFinite(targetMB) || targetMB <= 0) {
      sendError(res, 400, "BAD_REQUEST", "请输入有效的目标大小");
      return;
    }

    const jobId = generateJobId();
    const inputPath = path.join(os.tmpdir(), `pdf-compress-${jobId}-input.pdf`);
    const outputPath = path.join(os.tmpdir(), `pdf-compress-${jobId}-output.pdf`);

    await fsp.writeFile(inputPath, pdfPart.content);

    const job = {
      id: jobId,
      inputPath,
      outputPath,
      originalName: pdfPart.filename,
      targetBytes: parseSizeToBytes(targetMB),
      session,   // stored for refund on failure
      state: {
        id: jobId,
        status: "processing",
        progress: 0.05,
        message: "文件已上传",
        originalBytes: pdfPart.content.length,
        targetBytes: parseSizeToBytes(targetMB),
        resultBytes: null,
        ratio: null
      }
    };

    jobs.set(jobId, job);
    eventStreams.set(jobId, []);

    setTimeout(() => compressPdf(jobId, inputPath, parseSizeToBytes(targetMB), pdfPart.filename), 0);
    setTimeout(() => cleanupJob(jobId), 60 * 60 * 1000);

    json(res, 200, {
      ...job.state,
      points: consumeResult.points,
      pointsRemaining: consumeResult.points,
      ...(newToken ? { newToken } : {}),
      config: {
        siteName: "TinyPDF",
        maxUploadMB: 250
      }
    });
    return;
  }

  if (url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/events")) {
    const jobId = url.pathname.slice("/api/jobs/".length, -"/events".length);
    if (!jobs.has(jobId)) {
      sendError(res, 404, "NOT_FOUND", "任务不存在");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });

    const streams = eventStreams.get(jobId) || [];
    streams.push(res);
    eventStreams.set(jobId, streams);

    const job = jobs.get(jobId);
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
      sendError(res, 404, "NOT_FOUND", "文件不存在");
      return;
    }

    const stat = await fsp.stat(job.outputPath);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(job.state.downloadName || "compressed.pdf")}"`
    });
    const readStream = fs.createReadStream(job.outputPath);
    readStream.pipe(res);
    return;
  }

  if (url.pathname === "/api/user" && req.method === "GET") {
    const session = await authenticate(req);
    if (!session) {
      sendError(res, 401, "UNAUTHORIZED", "请先登录");
      return;
    }
    // Refresh points from DB
    const user = await db.get("SELECT * FROM users WHERE id = ?", [session.userId]);
    if (user) {
      session.points = user.points;
      session.email = user.email || null;
    }
    json(res, 200, { points: session.points, email: session.email || null, userId: session.userId });
    return;
  }

  if (url.pathname === "/api/auth/send-code" && req.method === "POST") {
    const body = await parseJson(req);
    const email = (body?.email || "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      sendError(res, 400, "INVALID_EMAIL", "请输入有效的邮箱地址");
      return;
    }
    const existing = otpStore.get(email);
    if (existing && existing.expires - Date.now() > 9 * 60 * 1000) {
      sendError(res, 429, "TOO_FREQUENT", "发送过于频繁，请稍后再试");
      return;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    otpStore.set(email, { code, expires: Date.now() + 10 * 60 * 1000 });
    console.log(`[OTP] ${email} → ${code}`);

    if (resendClient) {
      try {
        await resendClient.emails.send({
          from: RESEND_FROM,
          to: [email],
          subject: "TinyPDF - 登录验证码",
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
              <h2 style="margin:0 0 16px;color:#14213d">您的验证码</h2>
              <p style="color:#546079;margin:0 0 24px">用于 TinyPDF 邮箱绑定 / 登录，10分钟内有效。</p>
              <div style="font-size:36px;font-weight:700;letter-spacing:0.2em;color:#c7512c;
                          background:#fff8f4;border:2px solid #f0c4b0;border-radius:12px;
                          padding:20px;text-align:center">${code}</div>
              <p style="color:#546079;font-size:13px;margin:24px 0 0">如非本人操作，请忽略此邮件。</p>
            </div>
          `
        });
        json(res, 200, { ok: true, message: "验证码已发送到您的邮箱" });
      } catch (emailErr) {
        console.error("[email] send failed:", emailErr.message);
        json(res, 500, { code: "EMAIL_FAILED", message: "邮件发送失败，请稍后重试" });
      }
    } else {
      // Dev mode: no email service configured
      json(res, 200, { ok: true, message: "验证码已发送（开发模式：请查看服务器控制台）" });
    }
    return;
  }

  if (url.pathname === "/api/auth/verify-code" && req.method === "POST") {
    const body = await parseJson(req);
    const email = (body?.email || "").trim().toLowerCase();
    const code = (body?.code || "").trim();
    if (!email || !code) {
      sendError(res, 400, "MISSING_FIELDS", "请填写邮箱和验证码");
      return;
    }
    const entry = otpStore.get(email);
    if (!entry || entry.code !== code || Date.now() > entry.expires) {
      sendError(res, 400, "INVALID_CODE", "验证码无效或已过期");
      return;
    }
    otpStore.delete(email);

    // Find or create user by email
    let emailUser = await db.get("SELECT * FROM users WHERE email = ?", [email]);
    const currentSession = await authenticate(req);

    if (currentSession && !emailUser) {
      // Bind email to existing anonymous account
      await db.run("UPDATE users SET email = ? WHERE id = ?", [email, currentSession.userId]);
      currentSession.email = email;
      emailUser = await db.get("SELECT * FROM users WHERE id = ?", [currentSession.userId]);
    } else if (!emailUser) {
      // Create new user with this email
      const deviceId = crypto.randomBytes(16).toString("hex");
      const userId = crypto.randomBytes(16).toString("hex");
      const now = Date.now();
      await db.run(
        "INSERT INTO users (id, device_id, email, points, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?)",
        [userId, deviceId, email, INITIAL_POINTS, now, now]
      );
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, description, created_at) VALUES (?, ?, ?, ?, ?)",
        [userId, "gift", INITIAL_POINTS, "新用户赠送", now]
      );
      emailUser = await db.get("SELECT * FROM users WHERE id = ?", [userId]);
    }

    // Merge points if current anonymous session has more points
    if (currentSession && currentSession.userId !== emailUser.id) {
      if (currentSession.points > 0) {
        const merged = emailUser.points + currentSession.points;
        await db.run("UPDATE users SET points = ? WHERE id = ?", [merged, emailUser.id]);
        await db.run(
          "INSERT INTO transactions (user_id, type, amount, description, created_at) VALUES (?, ?, ?, ?, ?)",
          [emailUser.id, "merge", currentSession.points, "匿名积分合并", Date.now()]
        );
        emailUser.points = merged;
      }
    }

    const newToken = generateToken();
    sessions.set(newToken, {
      userId: emailUser.id,
      deviceId: emailUser.device_id,
      email: emailUser.email,
      points: emailUser.points,
      createdAt: Date.now()
    });

    json(res, 200, { token: newToken, points: emailUser.points, email: emailUser.email });
    return;
  }

  if (url.pathname === "/api/redeem" && req.method === "POST") {
    const session = await authenticate(req);
    if (!session) {
      sendError(res, 401, "UNAUTHORIZED", "请先登录");
      return;
    }
    const body = await parseJson(req);
    const code = (body?.code || "").trim().toUpperCase();
    if (!code) {
      sendError(res, 400, "MISSING_CODE", "请输入兑换码");
      return;
    }
    const redeemEntry = await db.get("SELECT * FROM redeem_codes WHERE code = ?", [code]);
    if (!redeemEntry) {
      sendError(res, 400, "INVALID_CODE", "兑换码不存在");
      return;
    }
    if (redeemEntry.used) {
      sendError(res, 400, "ALREADY_USED", "该兑换码已被使用");
      return;
    }
    await db.run(
      "UPDATE redeem_codes SET used = 1, used_by = ?, used_at = ? WHERE code = ?",
      [session.userId, Date.now(), code]
    );
    const result = await addPoints(session, redeemEntry.points, `兑换码: ${code}`);
    json(res, 200, { ok: true, added: redeemEntry.points, points: result.points });
    return;
  }

  sendError(res, 404, "NOT_FOUND", "接口不存在");
}

async function parseJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve({});
      }
    });
  });
}

function json(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
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

async function handleStatic(req, res, url) {
  let pathname = url.pathname;
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.join(PUBLIC_DIR, pathname);

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error("not file");

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size
    });

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  } catch {
    sendError(res, 404, "NOT_FOUND", "页面不存在");
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
    sendError(res, 500, "INTERNAL_ERROR", "服务器错误");
  }
});

async function main() {
  await checkGhostscript();
  await fsp.mkdir(path.dirname(DB_PATH), { recursive: true });
  await initDb();
  server.listen(PORT, HOST, () => {
    console.log(`PDF compress web app running at http://${HOST}:${PORT}`);
  });
}

main().catch(console.error);
