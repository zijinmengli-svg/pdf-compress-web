const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3487);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const BUILD_DIR = path.join(ROOT, ".build");
const SCRIPTS_DIR = path.join(ROOT, "scripts");
const COMPRESS_SOURCE = path.join(SCRIPTS_DIR, "compress_pdf.swift");
const RASTER_SOURCE = path.join(SCRIPTS_DIR, "rasterize_pdf.swift");
const INSPECT_SOURCE = path.join(SCRIPTS_DIR, "inspect_pdf.swift");
const COMPRESS_BINARY = path.join(BUILD_DIR, "compress-pdf");
const RASTER_BINARY = path.join(BUILD_DIR, "rasterize-pdf");
const INSPECT_BINARY = path.join(BUILD_DIR, "inspect-pdf");

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

async function ensureDirectories() {
  await fsp.mkdir(BUILD_DIR, { recursive: true });
}

async function buildSwiftBinaries() {
  await ensureDirectories();
  const builds = [
    { source: COMPRESS_SOURCE, binary: COMPRESS_BINARY },
    { source: RASTER_SOURCE, binary: RASTER_BINARY },
    { source: INSPECT_SOURCE, binary: INSPECT_BINARY }
  ];
  for (const { source, binary } of builds) {
    try {
      await fsp.access(binary, fs.constants.X_OK);
      const sourceStat = await fsp.stat(source);
      const binaryStat = await fsp.stat(binary);
      if (binaryStat.mtime > sourceStat.mtime) continue;
    } catch {}
    await new Promise((resolve, reject) => {
      const swiftc = spawn("swiftc", ["-O", "-o", binary, source]);
      swiftc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`swiftc failed with ${code}`)));
    });
  }
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

async function inspectPdf(inputPath) {
  const { stdout } = await new Promise((resolve, reject) => {
    const proc = spawn(INSPECT_BINARY, [inputPath]);
    const out = [];
    proc.stdout.on("data", (d) => out.push(d));
    proc.on("close", (code) => code === 0 ? resolve({ stdout: Buffer.concat(out).toString("utf8") }) : reject(new Error(`inspect failed ${code}`)));
  });
  return JSON.parse(stdout);
}

async function compressPdf(jobId, inputPath, targetBytes, originalName) {
  const job = jobs.get(jobId);
  if (!job) return;

  const outputPath = job.outputPath;
  const downloadName = fileNameWithSuffix(sanitizeFileName(originalName), ".compressed");

  try {
    const inspectInfo = await inspectPdf(inputPath);
    const originalBytes = inspectInfo.fileSize;

    job.state.originalBytes = originalBytes;
    job.state.targetBytes = targetBytes;
    job.state.progress = 0.1;
    job.state.message = "开始压缩";
    sendEvent(jobId, job.state);

    let resultBytes = null;
    let ratio = null;
    let lastOutput = null;
    let rasterMode = false;

    for (let i = 0; i < QUALITY_STEPS.length; i++) {
      const step = QUALITY_STEPS[i];
      job.state.progress = 0.1 + (i / QUALITY_STEPS.length) * 0.6;
      job.state.message = `压缩中 (${i + 1}/${QUALITY_STEPS.length})`;
      sendEvent(jobId, job.state);

      const tmpOut = `${outputPath}.${i}.tmp`;
      try {
        await new Promise((resolve, reject) => {
          const proc = spawn(COMPRESS_BINARY, [
            inputPath, tmpOut,
            String(step.scale), String(step.quality)
          ]);
          proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`compress failed ${code}`)));
        });

        const stat = await fsp.stat(tmpOut);
        if (stat.size <= targetBytes) {
          await fsp.rename(tmpOut, outputPath);
          resultBytes = stat.size;
          ratio = resultBytes / originalBytes;
          lastOutput = outputPath;
          break;
        } else {
          lastOutput = tmpOut;
        }
      } catch {
        try { fs.unlinkSync(tmpOut); } catch {}
      }
    }

    if (!resultBytes && lastOutput) {
      rasterMode = true;
      const stat = await fsp.stat(lastOutput);
      if (stat.size <= targetBytes * 1.5) {
        await fsp.rename(lastOutput, outputPath);
        resultBytes = stat.size;
        ratio = resultBytes / originalBytes;
      } else {
        for (let i = 0; i < RASTER_STEPS.length; i++) {
          const step = RASTER_STEPS[i];
          job.state.progress = 0.7 + (i / RASTER_STEPS.length) * 0.25;
          job.state.message = `深度优化中 (${i + 1}/${RASTER_STEPS.length})`;
          sendEvent(jobId, job.state);

          const tmpOut = `${outputPath}.r${i}.tmp`;
          try {
            await new Promise((resolve, reject) => {
              const proc = spawn(RASTER_BINARY, [
                lastOutput || inputPath, tmpOut,
                String(step.dpi), String(step.quality), step.grayscale ? "1" : "0"
              ]);
              proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`raster failed ${code}`)));
            });

            const stat = await fsp.stat(tmpOut);
            if (stat.size <= targetBytes || i === RASTER_STEPS.length - 1) {
              await fsp.rename(tmpOut, outputPath);
              resultBytes = stat.size;
              ratio = resultBytes / originalBytes;
              try { if (lastOutput && lastOutput !== inputPath) fs.unlinkSync(lastOutput); } catch {}
              break;
            }
            try { fs.unlinkSync(tmpOut); } catch {}
          } catch {
            try { fs.unlinkSync(tmpOut); } catch {}
          }
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
      siteName: "PDF压缩神器",
      maxUploadMB: 250
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
        siteName: "PDF压缩神器",
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

  sendError(res, 404, "NOT_FOUND", "接口不存在");
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
  await buildSwiftBinaries();
  server.listen(PORT, HOST, () => {
    console.log(`PDF compress web app running at http://${HOST}:${PORT}`);
  });
}

main().catch(console.error);
