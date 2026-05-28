// ─── DOM 引用 ───────────────────────────────────────────────────────────────
const form          = document.getElementById("compress-form");
const fileInput     = document.getElementById("pdf");
const dropzone      = document.getElementById("dropzone");
const targetInput   = document.getElementById("targetMB");
const fileMeta      = document.getElementById("file-meta");
const fileError     = document.getElementById("file-error");
const targetError   = document.getElementById("target-error");
const statusCard    = document.getElementById("status-card");
const statusTitle   = document.getElementById("status-title");
const statusPercent = document.getElementById("status-percent");
const progressFill  = document.getElementById("progress-fill");
const statusMessage = document.getElementById("status-message");
const metrics       = document.getElementById("metrics");
const submitButton  = document.getElementById("submit-button");
const downloadRow   = document.getElementById("download-row");
const downloadButton = document.getElementById("download-button");

// 使用次数显示
const usageRemaining = document.getElementById("usage-remaining");

// 广告弹窗
const adModal        = document.getElementById("ad-modal");
const adModalClose   = document.getElementById("ad-modal-close");
const adTomorrowBtn  = document.getElementById("ad-tomorrow-btn");
const adClaimBtn     = document.getElementById("ad-claim-btn");
const adProgressBar  = document.getElementById("ad-progress-bar");
const adCountdownText = document.getElementById("ad-countdown-text");
const adModalError   = document.getElementById("ad-modal-error");

// ─── 每日使用次数追踪 (localStorage) ─────────────────────────────────────
const FREE_PER_DAY     = 3;      // 每日免费次数
const AD_EXTRA_PER_DAY = 10;     // 每日广告最多额外次数
const USAGE_KEY        = "tinypdf_usage";

function todayStr() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function loadUsage() {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (!raw) return { date: todayStr(), count: 0, adCount: 0, totalLifetime: 0 };
    const data = JSON.parse(raw);
    // 跨天重置
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

function getRemainingFree() {
  const u = loadUsage();
  return Math.max(0, FREE_PER_DAY - u.count);
}

function canCompress() {
  const u = loadUsage();
  if (u.count < FREE_PER_DAY) return true;           // 还有免费次数
  if (adUnlocked) return true;                        // 看了广告
  return false;
}

function consumeCompress() {
  const u = loadUsage();
  u.count += 1;
  u.totalLifetime = (u.totalLifetime || 0) + 1;
  saveUsage(u);
  updateUsageDisplay();
}

function updateUsageDisplay() {
  const remaining = getRemainingFree();
  if (usageRemaining) usageRemaining.textContent = remaining;
  // 按钮文案提示
  if (!adUnlocked && remaining === 0) {
    submitButton.textContent = "看广告继续使用";
  } else {
    submitButton.textContent = "开始压缩";
  }
}

// ─── 广告解锁状态 ─────────────────────────────────────────────────────────
let adUnlocked   = false;   // 当前会话是否通过广告解锁
let adTimer      = null;
const AD_WATCH_SECONDS = 5;

function openAdModal() {
  adUnlocked = false;
  adClaimBtn.disabled = true;
  adClaimBtn.textContent = "请观看广告...";
  adProgressBar.style.width = "0%";
  adCountdownText.textContent = `请观看广告，${AD_WATCH_SECONDS} 秒后可继续...`;
  adModalError.textContent = "";
  adModal.classList.add("is-open");

  let elapsed = 0;
  adTimer = setInterval(() => {
    elapsed += 1;
    const pct = Math.min(100, Math.round((elapsed / AD_WATCH_SECONDS) * 100));
    adProgressBar.style.width = pct + "%";
    const remaining = AD_WATCH_SECONDS - elapsed;
    if (remaining > 0) {
      adCountdownText.textContent = `请观看广告，${remaining} 秒后可继续...`;
    } else {
      clearInterval(adTimer);
      adTimer = null;
      adCountdownText.textContent = "广告观看完成，点击继续使用";
      adClaimBtn.disabled = false;
      adClaimBtn.textContent = "继续使用";
    }
  }, 1000);
}

function closeAdModal() {
  clearInterval(adTimer);
  adTimer = null;
  adModal.classList.remove("is-open");
}

// 关闭按钮：取消，不解锁
adModalClose.addEventListener("click", closeAdModal);
// 明天再来
adTomorrowBtn.addEventListener("click", closeAdModal);
// 点击遮罩关闭
adModal.addEventListener("click", (e) => {
  if (e.target === adModal) closeAdModal();
});
// 继续使用（倒计时完成后）
adClaimBtn.addEventListener("click", () => {
  if (adClaimBtn.disabled) return;
  adUnlocked = true;
  closeAdModal();
  updateUsageDisplay();
  // 自动触发表单提交
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
});

// ─── 工具函数 ────────────────────────────────────────────────────────────────
let activeEvents      = null;
let activeJobId       = null;
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
    ["原文件大小",   formatMB(state.originalBytes)],
    ["目标大小",     formatMB(state.targetBytes)],
    ["实际压缩后大小", state.resultBytes ? formatMB(state.resultBytes) : "--"],
    ["压缩比例",     state.ratio != null ? ratioText(state.ratio) : "--"]
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
  if (file.size >= 250 * 1024 * 1024) return "文件过大，当前最大支持 250MB";
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
      submitButton.disabled = false;
      if (state.status === "done") {
        // 消耗一次使用次数（仅成功时）
        consumeCompress();
        adUnlocked = false; // 重置广告解锁状态
      }
      updateUsageDisplay();
    }
  };
  activeEvents.onerror = () => {
    if (activeEvents) activeEvents.close();
    activeEvents = null;
    submitButton.disabled = false;
    updateUsageDisplay();
  };
}

// ─── 事件监听 ────────────────────────────────────────────────────────────────
fileInput.addEventListener("change", () => {
  updateFileState(fileInput.files?.[0]);
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
});

targetInput.addEventListener("input", () => {
  showError(targetError, validateTarget(fileInput.files?.[0]));
});

downloadButton.addEventListener("click", startDownload);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const file           = fileInput.files?.[0];
  const fileValidation = validateFile(file);
  const targetValidation = validateTarget(file);
  showError(fileError, fileValidation);
  showError(targetError, targetValidation);
  if (fileValidation || targetValidation) return;

  // 检查今日次数
  if (!canCompress()) {
    openAdModal();
    return;
  }

  submitButton.disabled = true;
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
    submitButton.disabled = false;
    updateUsageDisplay();
  }
});

// ─── 初始化 ──────────────────────────────────────────────────────────────────
updateUsageDisplay();
