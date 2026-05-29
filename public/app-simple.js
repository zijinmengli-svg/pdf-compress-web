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
const usageRemaining = document.getElementById("usage-remaining");
const toastEl        = document.getElementById("toast");

// 广告弹窗
const adModal         = document.getElementById("ad-modal");
const adModalClose    = document.getElementById("ad-modal-close");
const adTomorrowBtn   = document.getElementById("ad-tomorrow-btn");
const adClaimBtn      = document.getElementById("ad-claim-btn");
const adProgressBar   = document.getElementById("ad-progress-bar");
const adCountdownText = document.getElementById("ad-countdown-text");
const adModalError    = document.getElementById("ad-modal-error");

// ─── 运营配置（从服务端 /api/config 获取，初始化完成前使用默认值）─────────
let FREE_PER_DAY = 3;   // 每日免费次数（服务端可通过 FREE_PER_DAY 环境变量覆盖）
let ADS_ENABLED  = false; // 广告是否启用（服务端 AD_ENABLED=true 时开启）

const AD_EXTRA_PER_DAY = 10;
const USAGE_KEY        = "tinypdf_usage";

// ─── 每日使用次数追踪 (localStorage) ─────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function loadUsage() {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (!raw) return { date: todayStr(), count: 0, adCount: 0, totalLifetime: 0 };
    const data = JSON.parse(raw);
    if (data.date !== todayStr()) {
      return { date: todayStr(), count: 0, adCount: 0, totalLifetime: data.totalLifetime || 0 };
    }
    return data;
  } catch {
    return { date: todayStr(), count: 0, adCount: 0, totalLifetime: 0 };
  }
}

function saveUsage(data) {
  localStorage.setItem(USAGE_KEY, JSON.stringify(data));
}

function getTotalRemaining() {
  const u = loadUsage();
  const freeLeft = Math.max(0, FREE_PER_DAY - u.count);
  const adLeft   = Math.max(0, u.adCount || 0);
  return freeLeft + adLeft;
}

function canCompress() {
  return getTotalRemaining() > 0;
}

function consumeCompress() {
  const u = loadUsage();
  if ((u.adCount || 0) > 0) {
    u.adCount -= 1;
  } else {
    u.count += 1;
  }
  u.totalLifetime = (u.totalLifetime || 0) + 1;
  saveUsage(u);
  updateUsageDisplay();
}

function updateUsageDisplay() {
  const remaining = getTotalRemaining();
  if (usageRemaining) usageRemaining.textContent = remaining;

  if (remaining === 0) {
    if (ADS_ENABLED) {
      submitButton.disabled = false;
      submitButton.textContent = "看广告继续使用";
      submitButton.classList.remove("btn-disabled");
    } else {
      submitButton.disabled = true;
      submitButton.textContent = "今日次数已用完";
      submitButton.classList.add("btn-disabled");
    }
  } else {
    if (!submitButton.classList.contains("btn-compressing")) {
      submitButton.disabled = false;
      submitButton.textContent = "开始压缩";
      submitButton.classList.remove("btn-disabled");
    }
  }
}

// ─── Toast 提示 ────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.hidden = false;
  toastEl.classList.add("toast-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("toast-visible");
    setTimeout(() => { toastEl.hidden = true; }, 300);
  }, 3000);
}

// ─── 广告模态框 ────────────────────────────────────────────────────────────
let adMode  = "compress";
let adTimer = null;
const AD_WATCH_SECONDS = 5;

function openAdModal(mode) {
  adMode = mode || "compress";
  adClaimBtn.disabled = true;
  adClaimBtn.textContent = "请观看广告...";
  adProgressBar.style.width = "0%";
  adCountdownText.textContent = `请观看广告，${AD_WATCH_SECONDS} 秒后可继续...`;
  adModalError.textContent = "";
  adModal.classList.add("is-open");

  let elapsed = 0;
  clearInterval(adTimer);
  adTimer = setInterval(() => {
    elapsed += 1;
    const pct = Math.min(100, Math.round((elapsed / AD_WATCH_SECONDS) * 100));
    adProgressBar.style.width = pct + "%";
    const left = AD_WATCH_SECONDS - elapsed;
    if (left > 0) {
      adCountdownText.textContent = `请观看广告，${left} 秒后可继续...`;
    } else {
      clearInterval(adTimer);
      adTimer = null;
      adCountdownText.textContent = "广告观看完成，点击继续";
      adClaimBtn.disabled = false;
      adClaimBtn.textContent = adMode === "bonus" ? "领取次数 +1" : "继续使用";
    }
  }, 1000);
}

function closeAdModal() {
  clearInterval(adTimer);
  adTimer = null;
  adModal.classList.remove("is-open");
}

adModalClose.addEventListener("click", closeAdModal);
adTomorrowBtn.addEventListener("click", closeAdModal);
adModal.addEventListener("click", (e) => {
  if (e.target === adModal) closeAdModal();
});

adClaimBtn.addEventListener("click", () => {
  if (adClaimBtn.disabled) return;
  if (adMode === "bonus") {
    const u = loadUsage();
    u.adCount = (u.adCount || 0) + 1;
    saveUsage(u);
    closeAdModal();
    updateUsageDisplay();
    return;
  }
  closeAdModal();
  doCompress(true);
});

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
  statusMessage.textContent  = state.error || state.message || "";
  setMetrics(state);
  downloadRow.hidden = state.status !== "done";
}

function validateFile(file) {
  if (!file) return "上传失败，请选择有效的 PDF 文件";
  if (!file.name.toLowerCase().endsWith(".pdf")) return "仅支持 PDF 文件，请重新上传";
  if (file.size <= 0) return "上传失败，请选择有效的 PDF 文件";
  if (file.size >= 100 * 1024 * 1024) return "文件过大，当前最大支持 100MB";
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
      submitButton.classList.remove("btn-compressing");
      submitButton.disabled = false;
      if (state.status === "done") consumeCompress();
      updateUsageDisplay();
    }
  };
  activeEvents.onerror = () => {
    if (activeEvents) activeEvents.close();
    activeEvents = null;
    submitButton.classList.remove("btn-compressing");
    submitButton.disabled = false;
    updateUsageDisplay();
  };
}

async function doCompress(bypassLimit = false) {
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
    submitButton.classList.remove("btn-compressing");
    submitButton.disabled = false;
    updateUsageDisplay();
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

  // 次数已用完处理
  if (!canCompress()) {
    if (ADS_ENABLED) {
      openAdModal("compress");
    } else {
      // 无广告模式：置灰 + Toast + GA4 埋点
      showToast("今日次数已用完，明日再来");
      if (typeof gtag === "function") {
        gtag("event", "quota_exhausted", {
          event_category: "engagement",
          event_label: "no_ad_mode"
        });
      }
    }
    return;
  }

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
      if (typeof cfg.freePerDay === "number") FREE_PER_DAY = cfg.freePerDay;
      if (typeof cfg.adsEnabled === "boolean") ADS_ENABLED = cfg.adsEnabled;
    }
  } catch {
    // 网络失败时使用默认值（FREE_PER_DAY=3, ADS_ENABLED=false）
  }
  // 更新 header 显示的总次数
  const usageDisplay = document.getElementById("usage-display");
  if (usageDisplay) {
    usageDisplay.innerHTML = `今日剩余 <span id="usage-remaining">--</span>/${FREE_PER_DAY} 次数`;
  }
  updateUsageDisplay();
}

initConfig();
