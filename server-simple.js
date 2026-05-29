const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3487);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");

// ── Ghostscript 压缩参数 ────────────────────────────────────────────────────
// 5档预设：从高质量（大文件）到低质量（小文件）依次尝试，找到第一个 <= 目标大小的预设后
// 在它和上一档之间做二分精细校准（最多 4 轮），将结果收敛到尽量接近目标。
const GS_PRESETS = [
  { settings: "/prepress", dpi: 300 },
  { settings: "/printer",  dpi: 200 },
  { settings: "/ebook",    dpi: 150 },
  { settings: "/screen",   dpi: 96  },
  { settings: "/screen",   dpi: 72  },
];

const MAX_UPLOAD_MB    = 100;
// ── 运营配置（通过 Railway 环境变量控制，无需改代码）────────────────────────
// FREE_PER_DAY  每日免费压缩次数（默认 3）
// AD_ENABLED    是否启用广告弹窗（默认 false，设为 "true" 开启）
const FREE_PER_DAY_CFG = Math.max(1, Number(process.env.FREE_PER_DAY) || 3);
const AD_ENABLED_CFG   = process.env.AD_ENABLED === "true";

const jobs = new Map();
const eventStreams = new Map();

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

// ── Ghostscript 压缩调用 ────────────────────────────────────────────────────
async function runGsJpeg(inputPath, outputPattern, dpi, quality) {
  return new Promise((resolve, reject) => {
    const args = [
      "-sDEVICE=jpeg",
      `-r${dpi}`,
      `-dJPEGQ=${quality}`,
      "-dNOPAUSE", "-dQUIET", "-dBATCH",
      `-sOutputFile=${outputPattern}`,
      inputPath
    ];
    const proc = spawn("gs", args);
    const errChunks = [];
    proc.stderr.on("data", (d) => errChunks.push(d));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gs jpeg exited ${code}: ${Buffer.concat(errChunks).toString().slice(0, 300)}`));
    });
  });
}

async function runGsCombine(imageFiles, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      "-sDEVICE=pdfwrite",
      "-dNOPAUSE", "-dQUIET", "-dBATCH",
      `-sOutputFile=${outputPath}`,
      ...imageFiles
    ];
    const proc = spawn("gs", args);
    const errChunks = [];
    proc.stderr.on("data", (d) => errChunks.push(d));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gs combine exited ${code}: ${Buffer.concat(errChunks).toString().slice(0, 300)}`));
    });
  });
}

async function runGs(inputPath, outputPath, settings, dpi) {
  return new Promise((resolve, reject) => {
    const args = [
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      "-dNOPAUSE", "-dQUIET", "-dBATCH",
      `-dPDFSETTINGS=${settings}`,
      "-dDownsampleColorImages=true",
      "-dDownsampleGrayImages=true",
      "-dDownsampleMonoImages=true",
      `-dColorImageResolution=${dpi}`,
      `-dGrayImageResolution=${dpi}`,
      `-dMonoImageResolution=${Math.min(600, dpi * 2)}`,
      `-sOutputFile=${outputPath}`,
      inputPath
    ];
    const proc = spawn("gs", args);
    const errChunks = [];
    proc.stderr.on("data", (d) => errChunks.push(d));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const msg = Buffer.concat(errChunks).toString("utf8").slice(0, 300);
        reject(new Error(`gs exited ${code}: ${msg}`));
      }
    });
  });
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
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'"
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
    // 删除所有可能泄漏的中间临时文件
    const base = job.outputPath;
    for (let i = 0; i < 5; i++) { try { fs.unlinkSync(`${base}.p${i}.tmp`);  } catch {} } // 预设扫描
    for (let r = 0; r < 4; r++) { try { fs.unlinkSync(`${base}.rf${r}.tmp`); } catch {} } // 二分精细
    for (let ri = 0; ri < 6; ri++) { try { fs.unlinkSync(`${base}.r${ri}.pdf`); } catch {} } // 栅格化
  }
  jobs.delete(jobId);
  eventStreams.delete(jobId);
}

async function compressPdf(jobId, inputPath, targetBytes, originalName) {
  const job = jobs.get(jobId);
  if (!job) return;

  const outputPath = job.outputPath;
  const downloadName = fileNameWithSuffix(sanitizeFileName(originalName), ".compressed");

  try {
    // ── 校验 PDF ──────────────────────────────────────────────────────────
    const [pdfInfo, inputStat] = await Promise.all([
      checkPdf(inputPath),
      fsp.stat(inputPath)
    ]);
    const originalBytes = inputStat.size;

    if (!pdfInfo.valid)     throw new Error("无效的 PDF 文件，无法压缩");
    if (pdfInfo.encrypted)  throw new Error("该 PDF 已加密，请先解除加密后再压缩");

    // 最小有效输出：>= 原文件 1% 且 >= 10KB
    const MIN_VALID_BYTES = Math.max(Math.round(originalBytes * 0.01), 10 * 1024);

    job.state.originalBytes = originalBytes;
    job.state.targetBytes   = targetBytes;
    job.state.progress      = 0.1;
    job.state.message       = "开始压缩";
    sendEvent(jobId, job.state);

    let resultBytes    = null;
    let ratio          = null;
    let bestValidPath  = null;
    let bestValidBytes = Infinity;
    let foundPresetIdx = -1;

    function registerBestValid(filePath, fileSize) {
      if (fileSize >= MIN_VALID_BYTES && fileSize < bestValidBytes) {
        if (bestValidPath && bestValidPath !== outputPath && bestValidPath !== inputPath) {
          try { fs.unlinkSync(bestValidPath); } catch {}
        }
        bestValidPath  = filePath;
        bestValidBytes = fileSize;
      }
    }

    // ── Phase 1: 5档预设扫描（从高质量到低质量）──────────────────────────
    // 找到第一个 <= 目标大小的档，同时记录上一档（超目标的最高质量档）
    for (let i = 0; i < GS_PRESETS.length; i++) {
      const preset = GS_PRESETS[i];
      job.state.progress = 0.1 + (i / GS_PRESETS.length) * 0.55;
      job.state.message  = `压缩中 (${i + 1}/${GS_PRESETS.length})`;
      sendEvent(jobId, job.state);

      const tmpOut = `${outputPath}.p${i}.tmp`;
      try {
        await runGs(inputPath, tmpOut, preset.settings, preset.dpi);
        const stat = await fsp.stat(tmpOut);

        if (stat.size < MIN_VALID_BYTES) {
          try { fs.unlinkSync(tmpOut); } catch {}
          break; // 更低档只会更差
        }

        registerBestValid(tmpOut, stat.size);

        if (stat.size <= targetBytes) {
          await fsp.rename(tmpOut, outputPath);
          resultBytes    = stat.size;
          ratio          = resultBytes / originalBytes;
          foundPresetIdx = i;
          bestValidPath  = outputPath;
          bestValidBytes = resultBytes;
          break;
        }
        // 超目标但有效 — 已通过 registerBestValid 保留
      } catch {
        try { fs.unlinkSync(tmpOut); } catch {}
      }
    }

    // ── Phase 2: 二分精细校准（在上一档 DPI 和当前档 DPI 之间细分）────────
    // 最多 4 轮，每轮将区间缩小一半，找到尽量接近目标的最高 DPI（最好画质）
    if (resultBytes !== null && foundPresetIdx > 0) {
      const loPreset = GS_PRESETS[foundPresetIdx];     // 达标档（DPI 低）
      const hiPreset = GS_PRESETS[foundPresetIdx - 1]; // 未达标档（DPI 高）
      let loDpi = loPreset.dpi;
      let hiDpi = hiPreset.dpi;

      for (let r = 0; r < 4; r++) {
        if (hiDpi - loDpi < 6) break; // 区间已足够小，停止
        const midDpi    = Math.round((loDpi + hiDpi) / 2);
        const tmpRefine = `${outputPath}.rf${r}.tmp`;
        job.state.progress = 0.65 + (r / 4) * 0.2;
        job.state.message  = `精细校准 (${r + 1}/4)`;
        sendEvent(jobId, job.state);

        try {
          await runGs(inputPath, tmpRefine, loPreset.settings, midDpi);
          const stat = await fsp.stat(tmpRefine);

          if (stat.size >= MIN_VALID_BYTES && stat.size <= targetBytes) {
            // midDpi 达标 → 尝试更高 DPI（更好画质）
            await fsp.rename(tmpRefine, outputPath);
            resultBytes    = stat.size;
            ratio          = resultBytes / originalBytes;
            bestValidPath  = outputPath;
            bestValidBytes = resultBytes;
            loDpi = midDpi;
          } else {
            // midDpi 超目标 → 降低 DPI
            hiDpi = midDpi;
            try { fs.unlinkSync(tmpRefine); } catch {}
          }
        } catch {
          try { fs.unlinkSync(tmpRefine); } catch {}
          break;
        }
      }
    }

    // ── Phase 3: 强制栅格化（矢量内容无法靠常规压缩达标时的最终手段）──────
    // 将每页渲染成 JPEG 再合并为 PDF，可强制压缩任何类型的 PDF 到目标大小
    if (resultBytes === null || resultBytes > targetBytes) {
      const RASTER_PRESETS = [
        { dpi: 150, quality: 85 },
        { dpi: 120, quality: 70 },
        { dpi: 96,  quality: 55 },
        { dpi: 72,  quality: 40 },
        { dpi: 72,  quality: 20 },
        { dpi: 48,  quality: 20 },
      ];

      const tmpDir  = path.dirname(outputPath);
      const jobBase = path.basename(outputPath, ".pdf");

      for (let ri = 0; ri < RASTER_PRESETS.length; ri++) {
        if (resultBytes !== null && resultBytes <= targetBytes) break;
        const { dpi, quality } = RASTER_PRESETS[ri];
        job.state.progress = 0.85 + (ri / RASTER_PRESETS.length) * 0.12;
        job.state.message  = `强力压缩中 (${ri + 1}/${RASTER_PRESETS.length})`;
        sendEvent(jobId, job.state);

        const pagePattern = path.join(tmpDir, `${jobBase}.r${ri}.p%04d.jpg`);
        const rasterOut   = `${outputPath}.r${ri}.pdf`;

        try {
          await runGsJpeg(inputPath, pagePattern, dpi, quality);

          const allFiles = await fsp.readdir(tmpDir);
          const pageFiles = allFiles
            .filter(f => f.startsWith(`${jobBase}.r${ri}.p`) && f.endsWith(".jpg"))
            .sort()
            .map(f => path.join(tmpDir, f));

          if (pageFiles.length === 0) continue;

          await runGsCombine(pageFiles, rasterOut);
          for (const f of pageFiles) { try { fs.unlinkSync(f); } catch {} }

          const stat = await fsp.stat(rasterOut);
          registerBestValid(rasterOut, stat.size);

          if (stat.size <= targetBytes) {
            await fsp.rename(rasterOut, outputPath);
            resultBytes    = stat.size;
            ratio          = resultBytes / originalBytes;
            bestValidPath  = outputPath;
            bestValidBytes = resultBytes;
            break;
          }
          try { fs.unlinkSync(rasterOut); } catch {}
        } catch {
          try {
            const leftover = await fsp.readdir(tmpDir);
            for (const f of leftover) {
              if (f.startsWith(`${jobBase}.r${ri}.p`) && f.endsWith(".jpg")) {
                try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
              }
            }
          } catch {}
          try { fs.unlinkSync(rasterOut); } catch {}
        }
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

    // ── 防止结果比原文件更大（Ghostscript 对已高度压缩的 PDF 重编码会膨胀）
    // 若最终结果 >= 原文件，直接以原文件作为输出（"最好结果就是原文件"）
    if (resultBytes !== null && resultBytes >= originalBytes) {
      await fsp.copyFile(inputPath, outputPath);
      resultBytes = originalBytes;
      ratio       = 1;
    }

    if (resultBytes === null) throw new Error("压缩失败，请重试");

    const reachedTarget = resultBytes <= targetBytes;
    job.state.progress     = 1;
    job.state.status       = "done";
    job.state.message      = reachedTarget
      ? "压缩完成"
      : "已尽力压缩——文件内容空间有限，当前结果为可在不损坏内容前提下的最小体积";
    job.state.resultBytes  = resultBytes;
    job.state.ratio        = ratio;
    job.state.downloadName = downloadName;
    sendEvent(jobId, job.state);

  } catch (error) {
    job.state.status   = "error";
    job.state.progress = 1;
    job.state.message  = "压缩失败";
    job.state.error    = error.message;
    sendEvent(jobId, job.state);
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
      freePerDay:  FREE_PER_DAY_CFG,
      adsEnabled:  AD_ENABLED_CFG,
      maxUploadMB: MAX_UPLOAD_MB
    });
    return;
  }

  if (url.pathname === "/api/track" && req.method === "POST") {
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/jobs" && req.method === "POST") {
    const contentType = req.headers["content-type"] || "";
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      sendError(res, 400, "BAD_REQUEST", "无效的请求");
      return;
    }

    let parts;
    try {
      parts = await handleMultipart(req, boundaryMatch[1], MAX_UPLOAD_MB * 1024 * 1024);
    } catch (e) {
      if (e.message === "file too large") {
        sendError(res, 413, "FILE_TOO_LARGE", `文件过大，最大支持 ${MAX_UPLOAD_MB}MB`);
      } else {
        sendError(res, 400, "BAD_REQUEST", "上传解析失败，请重试");
      }
      return;
    }
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

    // PDF 魔数校验：拒绝非 PDF 内容（防止任意文件上传）
    if (!pdfPart.content.slice(0, 5).equals(Buffer.from("%PDF-"))) {
      sendError(res, 400, "INVALID_FILE", "请上传有效的 PDF 文件");
      return;
    }

    // 并发任务数限制（防内存/磁盘 DoS）
    const activeJobs = [...jobs.values()].filter(j => j.state.status === "processing").length;
    if (activeJobs >= MAX_CONCURRENT_JOBS) {
      sendError(res, 429, "TOO_BUSY", "服务器繁忙，请稍后重试");
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
      config: {
        siteName: "TinyPDF",
        maxUploadMB: MAX_UPLOAD_MB
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

    let stat;
    try {
      stat = await fsp.stat(job.outputPath);
    } catch {
      sendError(res, 404, "NOT_FOUND", "文件已过期，请重新压缩");
      return;
    }
    const safeName = job.state.downloadName || "compressed.pdf";
    const encodedName = encodeURIComponent(safeName);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": stat.size,
      // RFC 6266 / RFC 5987：filename* 支持非 ASCII，filename 做 ASCII 兜底
      "Content-Disposition": `attachment; filename="compressed.pdf"; filename*=UTF-8''${encodedName}`
    });
    const readStream = fs.createReadStream(job.outputPath);
    readStream.pipe(res);
    return;
  }

  sendError(res, 404, "NOT_FOUND", "接口不存在");
}

function json(res, statusCode, payload, extraHeaders = {}) {
  setSecurityHeaders(res);
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

    setSecurityHeaders(res);
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
  server.listen(PORT, HOST, () => {
    console.log(`TinyPDF running at http://${HOST}:${PORT}`);
  });
}

main().catch(console.error);
