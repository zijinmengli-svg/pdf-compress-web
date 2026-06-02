// ─── DOM 引用 ───────────────────────────────────────────────────────────────
const form           = document.getElementById("compress-form");
const fileInput      = document.getElementById("pdf");
const dropzone       = document.getElementById("dropzone");
const targetInput    = document.getElementById("targetMB");
const fileMeta       = document.getElementById("file-meta");
const fileError      = document.getElementById("file-error");
const targetError    = document.getElementById("target-error");
const qualityWarning = document.getElementById("quality-warning");
const statusCard     = document.getElementById("status-card");
const statusTitle    = document.getElementById("status-title");
const statusPercent  = document.getElementById("status-percent");
const progressFill   = document.getElementById("progress-fill");
const statusMessage  = document.getElementById("status-message");
const metrics        = document.getElementById("metrics");
const submitButton   = document.getElementById("submit-button");
const downloadRow    = document.getElementById("download-row");
const downloadButton = document.getElementById("download-button");

// ─── 运营配置（从服务端 /api/config 获取，初始化完成前使用默认值）─────────
let ADS_ENABLED   = false; // 是否注入展示广告（AD_ENABLED=true）
let AD_CLIENT     = "";    // AdSense 发布商 ID
let AD_SLOT       = "";    // AdSense 广告单元 ID
let MAX_UPLOAD_MB = 100;  // 硬上限（MB）：超出直接拒绝

// ─── 提交按钮状态 ─────────────────────────────────────────────────────────
function resetSubmitButton() {
  submitButton.classList.remove("btn-compressing", "btn-disabled");
  submitButton.disabled = false;
  submitButton.textContent = "开始压缩";
}

// ─── 质量警告气泡 ──────────────────────────────────────────────────────────
// 当目标大小 < 原文件 15% 时提示用户，但不阻止压缩
const QUALITY_WARN_RATIO = 0.15;

function checkQualityWarning() {
  if (!qualityWarning) return;
  const file = fileInput.files?.[0];
  const targetMB = parseFloat(targetInput.value);
  if (file && Number.isFinite(targetMB) && targetMB > 0) {
    const originalMB = file.size / 1024 / 1024;
    qualityWarning.hidden = !(targetMB / originalMB < QUALITY_WARN_RATIO);
  } else {
    qualityWarning.hidden = true;
  }
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────
let activeEvents       = null;
let activeJobId        = null;
let activeDownloadName = "compressed.pdf";

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
    ["原文件大小",    formatMB(state.originalBytes)],
    ["目标压缩大小",  formatMB(state.targetBytes)],
    ["实际压缩后大小", state.resultBytes ? formatMB(state.resultBytes) : "--"],
    ["压缩比例",      (state.ratio != null && Number.isFinite(state.ratio)) ? ratioText(state.ratio) : "--"]
  ];
  metrics.innerHTML = rows
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

function setStatus(state) {
  statusCard.hidden = false;
  statusTitle.textContent =
    state.status === "done"  ? "压缩完成" :
    state.status === "error" ? "压缩失败" : "处理中";
  const percent = Math.round((state.progress || 0) * 100);
  statusPercent.textContent = `${percent}%`;
  progressFill.style.width  = `${percent}%`;
  let msg = state.error || state.message || "";
  if (state.status === "done" && state.rasterized) {
    msg += (msg ? " " : "") + "友情提示：为压缩到目标大小，页面已转为图片，清晰度可能有所下降。";
  }
  statusMessage.textContent  = msg;
  setMetrics(state);
  downloadRow.hidden = state.status !== "done";
}

function validateFile(file) {
  if (!file) return "上传失败，请选择有效的 PDF 文件";
  if (!file.name.toLowerCase().endsWith(".pdf")) return "仅支持 PDF 文件，请重新上传";
  if (file.size <= 0) return "上传失败，请选择有效的 PDF 文件";
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return `文件过大，当前最大支持 ${MAX_UPLOAD_MB}MB`;
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
    fileMeta.textContent = "拖拽文件到此处，或点击选择文件";
    showError(fileError, "");
    return;
  }
  fileMeta.textContent = `${file.name} · ${formatMB(file.size)}`;
  showError(fileError, validateFile(file));
}

async function startDownload() {
  if (!activeJobId) return;
  const link = document.createElement("a");
  link.href = `/api/jobs/${activeJobId}/download`;
  link.download = activeDownloadName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function submitCompression(body) {
  const response = await fetch("/api/jobs", { method: "POST", body });
  const payload  = await response.json();
  if (!response.ok) throw new Error(payload.message || "服务器繁忙，请稍后重试");

  activeJobId = payload.id;
  setStatus({
    status: payload.status,
    progress: 0.06,
    message: "正在校验文件",
    originalBytes: payload.originalBytes,
    targetBytes: payload.targetBytes,
    resultBytes: null,
    ratio: null
  });

  if (activeEvents) activeEvents.close();
  activeEvents = new EventSource(`/api/jobs/${payload.id}/events`);
  activeEvents.onmessage = (message) => {
    const state = JSON.parse(message.data);
    activeDownloadName = state.downloadName || activeDownloadName;
    setStatus(state);
    if (state.status === "done" || state.status === "error") {
      activeEvents.close();
      activeEvents = null;
      resetSubmitButton();
    }
  };
  activeEvents.onerror = () => {
    if (activeEvents) activeEvents.close();
    activeEvents = null;
    resetSubmitButton();
  };
}

async function doCompress() {
  const file = fileInput.files?.[0];
  const fileValidation   = validateFile(file);
  const targetValidation = validateTarget(file);
  showError(fileError, fileValidation);
  showError(targetError, targetValidation);
  if (fileValidation || targetValidation) return;

  submitButton.disabled = true;
  submitButton.classList.add("btn-compressing");
  submitButton.textContent = "压缩中...";
  downloadRow.hidden = true;
  setStatus({
    status: "processing",
    progress: 0.02,
    message: "正在上传文件，请稍候",
    originalBytes: file.size,
    targetBytes: parseFloat(targetInput.value) * 1024 * 1024,
    resultBytes: null,
    ratio: null
  });

  const body = new FormData();
  body.append("pdf", file);
  body.append("targetMB", targetInput.value.trim());

  try {
    await submitCompression(body);
  } catch (error) {
    setStatus({
      status: "error",
      progress: 1,
      message: error.message || "服务器繁忙，请稍后重试",
      error: error.message || "服务器繁忙，请稍后重试",
      originalBytes: file.size,
      targetBytes: parseFloat(targetInput.value) * 1024 * 1024,
      resultBytes: null,
      ratio: null
    });
    resetSubmitButton();
  }
}

// ─── 事件监听 ────────────────────────────────────────────────────────────────
fileInput.addEventListener("change", () => {
  updateFileState(fileInput.files?.[0]);
  checkQualityWarning();
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("is-dragover");
});
dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("is-dragover");
});
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("is-dragover");
  const files = e.dataTransfer?.files;
  if (!files || files.length !== 1) {
    showError(fileError, "仅支持单个 PDF 文件，请重新上传");
    return;
  }
  fileInput.files = files;
  updateFileState(files[0]);
  checkQualityWarning();
});

targetInput.addEventListener("input", () => {
  showError(targetError, validateTarget(fileInput.files?.[0]));
  checkQualityWarning();
});

downloadButton.addEventListener("click", startDownload);

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = fileInput.files?.[0];
  const fileValidation   = validateFile(file);
  const targetValidation = validateTarget(file);
  showError(fileError, fileValidation);
  showError(targetError, targetValidation);
  if (fileValidation || targetValidation) return;

  await doCompress();
});

// ─── 初始化：从服务端拉取配置 ─────────────────────────────────────────────
async function initConfig() {
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const cfg = await res.json();
      if (typeof cfg.adsEnabled  === "boolean") ADS_ENABLED   = cfg.adsEnabled;
      if (typeof cfg.adClient    === "string")  AD_CLIENT     = cfg.adClient;
      if (typeof cfg.adSlot      === "string")  AD_SLOT       = cfg.adSlot;
      if (typeof cfg.maxUploadMB === "number")  MAX_UPLOAD_MB = cfg.maxUploadMB;
    }
  } catch {
    // 网络失败时使用默认值（ADS_ENABLED=false → 不注入广告）
  }
  const usageDisplay = document.getElementById("usage-display");
  if (usageDisplay) {
    usageDisplay.textContent = `免费不限次 · 单文件 ≤ ${MAX_UPLOAD_MB}MB`;
  }
  // 初始化展示广告位：未启用/未配置 → 不显示、不占空间；启用且有 ID → 注入 AdSense
  if (window.initAdSlot) {
    window.initAdSlot("ad-slot-main", { adsEnabled: ADS_ENABLED, adClient: AD_CLIENT, adSlot: AD_SLOT });
  }
}

initConfig();
