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

let activeEvents = null;
let activeJobId = null;
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
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || "服务器繁忙，请稍后重试");
  }

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
      submitButton.textContent = "开始压缩";
    }
  };
  activeEvents.onerror = () => {
    if (activeEvents) activeEvents.close();
    activeEvents = null;
    submitButton.disabled = false;
    submitButton.textContent = "开始压缩";
  };
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  updateFileState(file);
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
    return;
  }
  fileInput.files = files;
  const file = files[0];
  updateFileState(file);
});

targetInput.addEventListener("input", async () => {
  const error = validateTarget(fileInput.files?.[0]);
  showError(targetError, error);
});

downloadButton.addEventListener("click", startDownload);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = fileInput.files?.[0];
  const fileValidation = validateFile(file);
  const targetValidation = validateTarget(file);
  showError(fileError, fileValidation);
  showError(targetError, targetValidation);
  if (fileValidation || targetValidation) return;

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
    submitButton.textContent = "开始压缩";
  }
});
