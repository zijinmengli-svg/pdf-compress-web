const form = document.getElementById("compress-form");
const fileInput = document.getElementById("pdf");
const dropzone = document.getElementById("dropzone");
const targetInput = document.getElementById("targetMB");
const fileMeta = document.getElementById("file-meta");
const fileError = document.getElementById("file-error");
const targetError = document.getElementById("target-error");
const statusCard = document.getElementById("status-card");
const statusTitle = document.getElementById("status-title");
const statusPercent = document.getElementById("status-percent");
const progressFill = document.getElementById("progress-fill");
const statusMessage = document.getElementById("status-message");
const metrics = document.getElementById("metrics");
const submitButton = document.getElementById("submit-button");
const downloadRow = document.getElementById("download-row");
const downloadButton = document.getElementById("download-button");

let activeResultBlob = null;
let activeDownloadName = "compressed.pdf";
let lastTrackedTargetMB = null;

const ATTEMPTS = [
  { scale: 1.6, quality: 0.9 },
  { scale: 1.45, quality: 0.84 },
  { scale: 1.3, quality: 0.78 },
  { scale: 1.15, quality: 0.72 },
  { scale: 1.0, quality: 0.66 },
  { scale: 0.9, quality: 0.58 },
  { scale: 0.8, quality: 0.5 },
  { scale: 0.7, quality: 0.42 },
  { scale: 0.6, quality: 0.34 }
];

const workerUrl = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

function trackEvent(name, payload = {}) {
  if (window.posthog && typeof window.posthog.capture === "function") {
    window.posthog.capture(name, payload);
  }
}

function formatNumber(value) {
  return Number(value.toFixed(2));
}

function getSizeBucket(mb) {
  if (mb <= 1) return "0-1MB";
  if (mb <= 5) return "1-5MB";
  if (mb <= 10) return "5-10MB";
  if (mb <= 20) return "10-20MB";
  if (mb <= 50) return "20-50MB";
  if (mb <= 100) return "50-100MB";
  return "100MB+";
}

function getTargetBucket(mb) {
  if (mb <= 0.5) return "0-0.5MB";
  if (mb <= 1) return "0.5-1MB";
  if (mb <= 3) return "1-3MB";
  if (mb <= 5) return "3-5MB";
  if (mb <= 10) return "5-10MB";
  if (mb <= 20) return "10-20MB";
  return "20MB+";
}

function getPageBucket(pageCount) {
  if (pageCount <= 5) return "1-5页";
  if (pageCount <= 20) return "6-20页";
  if (pageCount <= 50) return "21-50页";
  if (pageCount <= 100) return "51-100页";
  return "100页+";
}

function getCompressionBucket(ratio) {
  if (ratio <= 0.2) return "压缩后<=20%";
  if (ratio <= 0.4) return "压缩后20-40%";
  if (ratio <= 0.6) return "压缩后40-60%";
  if (ratio <= 0.8) return "压缩后60-80%";
  return "压缩后80%+";
}

function sanitizeErrorMessage(message) {
  if (!message) return "unknown";
  if (message.includes("压缩引擎")) return "runtime_load_failed";
  if (message.includes("页面转码")) return "page_render_failed";
  if (message.includes("PDF")) return "invalid_pdf";
  return "compress_failed";
}

function buildCommonPayload({ file, targetMB, pageCount, source = "picker" }) {
  const originalMB = formatNumber(file.size / 1024 / 1024);
  const payload = {
    file_name: file.name,
    file_extension: file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "unknown",
    file_bytes: file.size,
    original_mb: originalMB,
    original_bucket: getSizeBucket(originalMB),
    upload_source: source
  };

  if (Number.isFinite(targetMB)) {
    payload.target_mb = formatNumber(targetMB);
    payload.target_bucket = getTargetBucket(targetMB);
  }

  if (Number.isFinite(pageCount)) {
    payload.page_count = pageCount;
    payload.page_bucket = getPageBucket(pageCount);
  }

  return payload;
}

function trackPageEnter() {
  trackEvent("page_enter", {
    page_path: window.location.pathname,
    page_url: window.location.href,
    page_title: document.title,
    referrer: document.referrer || "",
    user_agent: navigator.userAgent
  });
}

function maybeTrackTargetValueEntered(file) {
  const targetValidation = validateTarget(file);
  if (targetValidation) return false;

  const targetMB = parseFloat(targetInput.value);
  if (!Number.isFinite(targetMB) || targetMB === lastTrackedTargetMB) return false;
  lastTrackedTargetMB = targetMB;

  trackEvent("target_value_entered", {
    ...(file ? buildCommonPayload({ file, targetMB }) : {}),
    target_mb: formatNumber(targetMB)
  });
  return true;
}

function formatMB(bytes) {
  if (!Number.isFinite(bytes)) return "--";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ratioText(ratio) {
  if (!Number.isFinite(ratio)) return "--";
  return `${(ratio * 100).toFixed(1)}%`;
}

function showError(target, message) {
  target.hidden = !message;
  target.textContent = message || "";
}

function setMetrics(state) {
  const rows = [
    ["原文件大小", formatMB(state.originalBytes)],
    ["目标大小", formatMB(state.targetBytes)],
    ["实际压缩后大小", state.resultBytes ? formatMB(state.resultBytes) : "--"],
    ["压缩比例", state.ratio != null ? ratioText(state.ratio) : "--"]
  ];
  metrics.innerHTML = rows
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

function setStatus(state) {
  statusCard.hidden = false;
  statusTitle.textContent =
    state.status === "done" ? "压缩完成" :
    state.status === "error" ? "压缩失败" :
    "处理中";
  const percent = Math.round((state.progress || 0) * 100);
  statusPercent.textContent = `${percent}%`;
  progressFill.style.width = `${percent}%`;
  statusMessage.textContent = state.error || state.message || "";
  setMetrics(state);
  downloadRow.hidden = state.status !== "done";
}

function validateFile(file) {
  if (!file) return "上传失败，请选择有效的 PDF 文件";
  if (!file.name.toLowerCase().endsWith(".pdf")) return "仅支持 PDF 文件，请重新上传";
  if (file.size <= 0) return "上传失败，请选择有效的 PDF 文件";
  if (file.size >= 250 * 1024 * 1024) {
    return "文件过大，当前最大支持 250MB";
  }
  return "";
}

function validateTarget(file) {
  const raw = targetInput.value.trim();
  if (!raw) return "请输入目标文件大小";
  if (!/^\d+(\.\d+)?$/.test(raw)) return "请输入有效数字";
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return "请输入有效数字";
  if (numeric <= 0) return "目标大小必须大于 0";
  if (file && numeric >= file.size / 1024 / 1024) return "目标大小需小于原文件大小";
  return "";
}

function updateFileState(file) {
  if (!file) {
    fileMeta.textContent = "仅支持单个 .pdf 文件，建议不超过 250MB";
    showError(fileError, "");
    return;
  }
  fileMeta.textContent = `${file.name} · ${formatMB(file.size)}`;
  const error = validateFile(file);
  showError(fileError, error);
}

async function startDownload() {
  if (!activeResultBlob) return;
  trackEvent("download_clicked", {
    file_name: activeDownloadName,
    result_bytes: activeResultBlob.size,
    result_mb: formatNumber(activeResultBlob.size / 1024 / 1024),
    result_bucket: getSizeBucket(activeResultBlob.size / 1024 / 1024)
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(activeResultBlob);
  link.download = activeDownloadName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function buildDownloadName(name) {
  const index = name.toLowerCase().lastIndexOf(".pdf");
  if (index === -1) return `${name}-compressed.pdf`;
  return `${name.slice(0, index)}-compressed.pdf`;
}

function blobToUint8Array(blob) {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("页面转码失败，请重试"));
      },
      "image/jpeg",
      quality
    );
  });
}

function ensurePdfRuntime() {
  const pdfjsLib = window.pdfjsLib;
  const jsPDF = window.jspdf?.jsPDF;
  if (!pdfjsLib || !jsPDF) {
    throw new Error("压缩引擎加载失败，请刷新页面后重试");
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  return { pdfjsLib, jsPDF };
}

async function renderAttempt(pdf, attempt, originalBytes, targetBytes) {
  const { jsPDF } = ensurePdfRuntime();
  let doc = null;
  const pageCount = pdf.numPages;

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const renderViewport = page.getViewport({ scale: attempt.scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });

    canvas.width = Math.max(1, Math.floor(renderViewport.width));
    canvas.height = Math.max(1, Math.floor(renderViewport.height));

    await page.render({ canvasContext: context, viewport: renderViewport }).promise;

    const imageBlob = await canvasToBlob(canvas, attempt.quality);
    const imageData = await blobToUint8Array(imageBlob);

    if (!doc) {
      doc = new jsPDF({
        orientation: baseViewport.width > baseViewport.height ? "landscape" : "portrait",
        unit: "pt",
        format: [baseViewport.width, baseViewport.height],
        compress: true
      });
    } else {
      doc.addPage([baseViewport.width, baseViewport.height], baseViewport.width > baseViewport.height ? "landscape" : "portrait");
    }

    doc.addImage(imageData, "JPEG", 0, 0, baseViewport.width, baseViewport.height, undefined, "FAST");

    setStatus({
      status: "processing",
      progress: 0.12 + ((pageNumber / pageCount) * 0.72),
      message: `正在压缩第 ${pageNumber}/${pageCount} 页`,
      originalBytes,
      targetBytes,
      resultBytes: null,
      ratio: null
    });
  }

  const arrayBuffer = doc.output("arraybuffer");
  return new Blob([arrayBuffer], { type: "application/pdf" });
}

async function compressPdf(file, targetBytes) {
  const { pdfjsLib } = ensurePdfRuntime();
  const sourceBytes = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: sourceBytes }).promise;
  let fallbackBlob = null;

  for (let index = 0; index < ATTEMPTS.length; index += 1) {
    const attempt = ATTEMPTS[index];
    setStatus({
      status: "processing",
      progress: index / ATTEMPTS.length * 0.1,
      message: `正在尝试压缩策略 ${index + 1}/${ATTEMPTS.length}`,
      originalBytes: file.size,
      targetBytes,
      resultBytes: fallbackBlob?.size || null,
      ratio: fallbackBlob ? fallbackBlob.size / file.size : null
    });

    const blob = await renderAttempt(pdf, attempt, file.size, targetBytes);
    fallbackBlob = blob;

    if (blob.size <= targetBytes) {
      return { blob, pageCount: pdf.numPages, attemptsUsed: index + 1, hitTarget: true };
    }
  }

  return {
    blob: fallbackBlob,
    pageCount: pdf.numPages,
    attemptsUsed: ATTEMPTS.length,
    hitTarget: fallbackBlob ? fallbackBlob.size <= targetBytes : false
  };
}

trackPageEnter();

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  lastTrackedTargetMB = null;
  updateFileState(file);
  if (file) {
    trackEvent("file_selected", buildCommonPayload({ file }));
  }
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("is-dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("is-dragover");
});

dropzone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-dragover");
  const files = event.dataTransfer?.files;
  if (!files || files.length !== 1) {
    showError(fileError, "仅支持单个 PDF 文件，请重新上传");
    trackEvent("invalid_drop_file_count", { file_count: files ? files.length : 0 });
    return;
  }
  fileInput.files = files;
  const file = files[0];
  lastTrackedTargetMB = null;
  updateFileState(file);
  trackEvent("file_selected", buildCommonPayload({ file, source: "drop" }));
});

targetInput.addEventListener("input", async () => {
  const error = validateTarget(fileInput.files?.[0]);
  showError(targetError, error);
});

targetInput.addEventListener("blur", async () => {
  maybeTrackTargetValueEntered(fileInput.files?.[0]);
});

downloadButton.addEventListener("click", startDownload);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = fileInput.files?.[0];
  const fileValidation = validateFile(file);
  const targetValidation = validateTarget(file);
  showError(fileError, fileValidation);
  showError(targetError, targetValidation);
  if (fileValidation || targetValidation) {
    trackEvent("compress_validation_failed", {
      validation_type: fileValidation ? "file" : "target",
      validation_message: fileValidation || targetValidation
    });
    return;
  }

  const targetMB = parseFloat(targetInput.value);
  maybeTrackTargetValueEntered(file);
  trackEvent("compress_started", buildCommonPayload({ file, targetMB }));

  submitButton.disabled = true;
  submitButton.textContent = "压缩中...";
  downloadRow.hidden = true;
  activeResultBlob = null;
  setStatus({
    status: "processing",
    progress: 0.02,
    message: "正在读取文件，请稍候",
    originalBytes: file.size,
    targetBytes: targetMB * 1024 * 1024,
    resultBytes: null,
    ratio: null
  });

  try {
    const targetBytes = targetMB * 1024 * 1024;
    const { blob: resultBlob, pageCount, attemptsUsed, hitTarget } = await compressPdf(file, targetBytes);

    activeResultBlob = resultBlob;
    activeDownloadName = buildDownloadName(file.name);
    const resultMB = formatNumber(resultBlob.size / 1024 / 1024);
    const ratio = resultBlob.size / file.size;
    trackEvent("compress_finished", {
      ...buildCommonPayload({ file, targetMB, pageCount }),
      success: true,
      output_file_name: activeDownloadName,
      result_bytes: resultBlob.size,
      result_mb: resultMB,
      result_bucket: getSizeBucket(resultMB),
      compression_ratio: formatNumber(ratio),
      compression_bucket: getCompressionBucket(ratio),
      hit_target: hitTarget,
      attempts_used: attemptsUsed
    });

    setStatus({
      status: "done",
      progress: 1,
      message:
        resultBlob.size <= targetBytes
          ? "压缩完成，已达到目标大小"
          : "压缩完成，已尽量接近目标大小",
      originalBytes: file.size,
      targetBytes,
      resultBytes: resultBlob.size,
      ratio: resultBlob.size / file.size
    });
    downloadRow.hidden = false;
    submitButton.disabled = false;
    submitButton.textContent = "开始压缩";
  } catch (error) {
    trackEvent("compress_failed", {
      ...buildCommonPayload({ file, targetMB }),
      error_message: error.message || "压缩失败",
      error_code: sanitizeErrorMessage(error.message)
    });
    setStatus({
      status: "error",
      progress: 1,
      message: error.message || "压缩失败，请稍后重试",
      error: error.message || "压缩失败，请稍后重试",
      originalBytes: file.size,
      targetBytes: targetMB * 1024 * 1024,
      resultBytes: null,
      ratio: null
    });
    submitButton.disabled = false;
    submitButton.textContent = "开始压缩";
  }
});
