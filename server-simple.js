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
    job.state.message  = "强力压缩中";
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
  if (!pdf) throw new Error("栅格化失败");
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
      "-dPDFSETTINGS=/prepress",
      "-dNOPAUSE", "-dBATCH", "-dQUIET",
      "-dPassThroughJPEGImages=false",
      "-dAutoFilterColorImages=false", "-dColorImageFilter=/DCTEncode",
      "-dAutoFilterGrayImages=false", "-dGrayImageFilter=/DCTEncode",
      "-dDownsampleColorImages=true", `-dColorImageResolution=${resCap}`,
      "-dDownsampleGrayImages=true", `-dGrayImageResolution=${resCap}`,
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

// 连续质量搜索：在 QFactor 维度做带括的预测式搜索，找出 <= 目标体积的最大结果
// （即目标内最接近、最清晰的矢量保真结果）。
//  - 若最高画质（QF_BEST）仍 <= 目标：直接返回它（无法更优，已是最清晰）。
//  - 若最低画质（QF_WORST）仍 > 目标：返回 null（矢量重编码到不了，交由栅格化兜底）。
//  - 否则在 (QF_BEST, QF_WORST) 间用幂律插值快速收敛。
// 返回 { path, bytes } 或 null。中间临时文件即用即删，只保留当前最优。
async function qfactorSearch(jobId, job, inputPath, outBase, targetBytes, minValidBytes) {
  const QF_BEST = 0.02;   // 最高画质（体积最大）
  const QF_WORST = 3.0;   // 最低画质（体积最小）
  let best = null;        // { path, bytes, qf } —— <= 目标内体积最大者
  let over = null;        // { qf, bytes } —— > 目标中 qf 最大者（用于括住目标）
  let runIdx = 0, step = 0;

  const announce = () => {
    job.state.progress = Math.min(0.8, 0.12 + step * 0.1);
    job.state.message  = "精准压缩中";
    sendEvent(jobId, job.state);
    step++;
  };

  // 跑一档 QFactor，分类入 best / over，即用即删非最优文件。返回字节数或 null。
  const runQf = async (qf) => {
    announce();
    const out = `${outBase}.qf${runIdx++}.tmp`;
    try { await runGsQf(inputPath, out, qf, 300); }
    catch { try { fs.unlinkSync(out); } catch {} return null; }
    let st; try { st = await fsp.stat(out); } catch { return null; }
    if (st.size < minValidBytes) { try { fs.unlinkSync(out); } catch {} return null; }
    if (st.size > targetBytes) {
      if (!over || qf > over.qf) over = { qf, bytes: st.size };
      try { fs.unlinkSync(out); } catch {}
    } else if (!best || st.size > best.bytes) {
      if (best && best.path !== out) { try { fs.unlinkSync(best.path); } catch {} }
      best = { path: out, bytes: st.size, qf };
    } else {
      try { fs.unlinkSync(out); } catch {}
    }
    return st.size;
  };

  // 边界探测
  const sBest = await runQf(QF_BEST);
  if (sBest !== null && sBest <= targetBytes) return best;   // 最高画质已达标 → 最优
  const sWorst = await runQf(QF_WORST);
  if (sWorst === null) return best;                          // 最低画质都失败
  if (sWorst > targetBytes) return null;                     // 矢量重编码到不了 → 交栅格化

  // 预测式带括搜索（幂律：size = k * qf^(-p)）
  for (let it = 0; it < 5; it++) {
    if (!over || !best) break;
    if (best.bytes >= targetBytes * 0.96) break;             // 足够接近目标
    if (best.qf - over.qf < 0.003) break;                    // 区间过小
    const p = Math.log(over.bytes / best.bytes) / Math.log(best.qf / over.qf);
    let q = (!isFinite(p) || p <= 0)
      ? (over.qf + best.qf) / 2                               // 退化 → 二分
      : over.qf * Math.pow(over.bytes / targetBytes, 1 / p); // 幂律预测命中目标
    const loB = over.qf + (best.qf - over.qf) * 0.05;
    const hiB = best.qf - (best.qf - over.qf) * 0.05;
    q = Math.min(hiB, Math.max(loB, q));                     // 严格夹在括内
    const s = await runQf(q);
    if (s === null) break;
  }
  return best;
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
    // 删除所有可能泄漏的中间临时文件（QFactor 搜索遗留）
    const base = job.outputPath;
    for (let i = 0; i < 10; i++) { try { fs.unlinkSync(`${base}.qf${i}.tmp`); } catch {} }
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

    // ── 原文件已不大于目标：无需压缩，原文件即最清晰结果 ──────────────────
    if (originalBytes <= targetBytes) {
      await fsp.copyFile(inputPath, outputPath);
      resultBytes = originalBytes;
      ratio       = 1;
    }

    // ── 主压缩：QFactor 连续质量搜索（矢量保真，目标内体积最大 = 最清晰）──
    // 在 QFactor 维度预测式搜索，命中 <= 目标的最大体积；文字/矢量保持清晰不栅格化。
    if (resultBytes === null) {
      try {
        const qres = await qfactorSearch(jobId, job, inputPath, outputPath, targetBytes, MIN_VALID_BYTES);
        if (qres && qres.bytes >= MIN_VALID_BYTES) {
          if (qres.path !== outputPath) await fsp.rename(qres.path, outputPath);
          resultBytes    = qres.bytes;
          ratio          = resultBytes / originalBytes;
          bestValidPath  = outputPath;
          bestValidBytes = resultBytes;
        }
      } catch {
        // 搜索失败 → 交由栅格化兜底
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

    if (resultBytes === null) throw new Error("压缩失败，请重试");

    const reachedTarget    = resultBytes <= targetBytes;
    const noCompressNeeded = resultBytes >= originalBytes; // 已回退原文件：目标 ≥ 原文件
    job.state.progress     = 1;
    job.state.status       = "done";
    job.state.message      = noCompressNeeded
      ? "原文件已不大于目标大小，无需压缩"
      : reachedTarget
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
