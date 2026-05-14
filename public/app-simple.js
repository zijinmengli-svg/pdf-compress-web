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
const configBar = document.getElementById("config-bar");
const submitButton = document.getElementById("submit-button");
const downloadRow = document.getElementById("download-row");
const downloadButton = document.getElementById("download-button");
const loginBtn = document.getElementById("login-btn");

let appConfig = null;
let activeEvents = null;
let activeJobId = null;
let activeDownloadName = "compressed.pdf";
let authToken = localStorage.getItem("pdf_compress_token") || sessionStorage.getItem("pdf_compress_token");

function saveToken(token) {
  authToken = token;
  try { localStorage.setItem("pdf_compress_token", token); } catch (e) {
    sessionStorage.setItem("pdf_compress_token", token);
  }
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

function updatePointsDisplay(points) {
  const el = document.getElementById("points-value");
  if (el) el.textContent = points;
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

function renderConfigBar() {
  if (!appConfig) return;
  const chips = [];
  chips.push(`<span class="chip">单文件上限：${appConfig.maxUploadMB}MB</span>`);
  if (appConfig.pointsPerCompress) {
    chips.push(`<span class="chip">压缩消耗：${appConfig.pointsPerCompress} 积分/次</span>`);
  }
  if (appConfig.initialPoints) {
    chips.push(`<span class="chip">新用户赠送：${appConfig.initialPoints} 积分</span>`);
  }
  configBar.innerHTML = chips.join("");
}

async function fetchConfig() {
  const response = await fetch("/api/config");
  appConfig = await response.json();
  renderConfigBar();
}

async function ensureSession() {
  if (authToken) return authToken;
  const deviceId = localStorage.getItem("pdf_compress_device_id") || (() => {
    const id = "device_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("pdf_compress_device_id", id);
    return id;
  })();
  const res = await fetch("/api/auth/anonymous", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId })
  });
  if (!res.ok) throw new Error("无法创建会话");
  const data = await res.json();
  saveToken(data.token);
  updatePointsDisplay(data.user.points);
  if (data.user.email) loginBtn.textContent = data.user.email;
  return data.token;
}

async function fetchPoints() {
  const pointsEl = document.getElementById("points-value");
  try {
    const token = await ensureSession();
    const res = await fetch("/api/user", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) {
      if (res.status === 401) {
        // Session expired, create new one
        authToken = null;
        localStorage.removeItem("pdf_compress_token");
        sessionStorage.removeItem("pdf_compress_token");
        await ensureSession();
        return;
      }
      throw new Error("获取积分失败");
    }
    const data = await res.json();
    updatePointsDisplay(data.points);
    if (data.email) loginBtn.textContent = data.email;
  } catch (err) {
    console.error("fetchPoints error:", err);
    if (pointsEl) pointsEl.textContent = "?";
  }
}

function validateFile(file) {
  if (!file) return "上传失败，请选择有效的 PDF 文件";
  if (!file.name.toLowerCase().endsWith(".pdf")) return "仅支持 PDF 文件，请重新上传";
  if (file.size <= 0) return "上传失败，请选择有效的 PDF 文件";
  if (appConfig && file.size >= appConfig.maxUploadMB * 1024 * 1024) {
    return `文件过大，当前最大支持 ${appConfig.maxUploadMB}MB`;
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
  const token = authToken;
  const headers = token ? { "Authorization": `Bearer ${token}` } : {};
  const response = await fetch("/api/jobs", { method: "POST", body, headers });
  const payload = await response.json();

  if (response.status === 402) {
    submitButton.disabled = false;
    submitButton.textContent = "开始压缩";
    if (payload.code === "INSUFFICIENT_POINTS") {
      document.getElementById("insufficient-card").hidden = false;
      return;
    }
    return;
  }

  if (!response.ok) {
    throw new Error(payload.message || "服务器繁忙，请稍后重试");
  }

  // Save new token if server auto-created one
  if (payload.newToken) {
    saveToken(payload.newToken);
  }

  document.getElementById("insufficient-card").hidden = true;

  if (typeof payload.pointsRemaining === "number") {
    updatePointsDisplay(payload.pointsRemaining);
  } else if (typeof payload.points === "number") {
    updatePointsDisplay(payload.points);
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
    if (state.downloadName) activeDownloadName = state.downloadName;
    setStatus(state);
    if (state.status === "done" || state.status === "error") {
      activeEvents.close();
      activeEvents = null;
      submitButton.disabled = false;
      submitButton.textContent = "开始压缩";
      fetchPoints();
    }
  };
  activeEvents.onerror = () => {
    if (activeEvents) activeEvents.close();
    activeEvents = null;
    submitButton.disabled = false;
    submitButton.textContent = "开始压缩";
  };
}

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
  document.getElementById("insufficient-card").hidden = true;
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

fileInput.addEventListener("change", () => updateFileState(fileInput.files?.[0]));

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("is-dragover");
});

dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragover"));

dropzone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-dragover");
  const files = event.dataTransfer?.files;
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

// ---- 登录弹窗 ----
const loginModal = document.getElementById("login-modal");
const modalClose = document.getElementById("modal-close");
const sendCodeBtn = document.getElementById("send-code-btn");
const verifyBtn = document.getElementById("verify-btn");
const modalEmail = document.getElementById("modal-email");
const modalCode = document.getElementById("modal-code");
const modalError = document.getElementById("modal-error");

function openModal() { loginModal.classList.add("is-open"); modalEmail.focus(); }
function closeModal() { loginModal.classList.remove("is-open"); modalError.textContent = ""; }

loginBtn.addEventListener("click", openModal);
modalClose.addEventListener("click", closeModal);
loginModal.addEventListener("click", (e) => { if (e.target === loginModal) closeModal(); });

let sendCooldown = 0;
let cooldownTimer = null;

function startCooldown() {
  sendCooldown = 60;
  sendCodeBtn.disabled = true;
  clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    sendCooldown--;
    sendCodeBtn.textContent = sendCooldown > 0 ? `${sendCooldown}s 后重发` : "发送验证码";
    if (sendCooldown <= 0) {
      clearInterval(cooldownTimer);
      sendCodeBtn.disabled = false;
    }
  }, 1000);
}

sendCodeBtn.addEventListener("click", async () => {
  const email = modalEmail.value.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    modalError.textContent = "请输入正确的邮箱地址";
    return;
  }
  modalError.textContent = "";
  sendCodeBtn.disabled = true;
  sendCodeBtn.textContent = "发送中...";
  try {
    const res = await fetch("/api/auth/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) {
      modalError.textContent = data.message || "发送失败，请稍后重试";
      sendCodeBtn.disabled = false;
      sendCodeBtn.textContent = "发送验证码";
      return;
    }
    startCooldown();
    modalCode.focus();
  } catch (err) {
    modalError.textContent = "网络错误，请稍后重试";
    sendCodeBtn.disabled = false;
    sendCodeBtn.textContent = "发送验证码";
  }
});

verifyBtn.addEventListener("click", async () => {
  const email = modalEmail.value.trim();
  const code = modalCode.value.trim();
  if (!email || !code) {
    modalError.textContent = "请填写邮箱和验证码";
    return;
  }
  modalError.textContent = "";
  verifyBtn.disabled = true;
  verifyBtn.textContent = "验证中...";
  try {
    const headers = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    const res = await fetch("/api/auth/verify-code", {
      method: "POST",
      headers,
      body: JSON.stringify({ email, code })
    });
    const data = await res.json();
    if (!res.ok) {
      modalError.textContent = data.message || "验证失败，请检查验证码";
      verifyBtn.disabled = false;
      verifyBtn.textContent = "确认登录 / 绑定";
      return;
    }
    saveToken(data.token);
    updatePointsDisplay(data.points);
    loginBtn.textContent = email;
    closeModal();
  } catch (err) {
    modalError.textContent = "网络错误，请稍后重试";
    verifyBtn.disabled = false;
    verifyBtn.textContent = "确认登录 / 绑定";
  }
});

// ---- 兑换码 ----
document.getElementById("redeem-btn").addEventListener("click", async () => {
  const code = document.getElementById("redeem-input").value.trim();
  const errEl = document.getElementById("redeem-error");
  const okEl = document.getElementById("redeem-success");
  errEl.textContent = "";
  okEl.textContent = "";
  if (!code) { errEl.textContent = "请输入兑换码"; return; }
  try {
    const token = await ensureSession();
    const res = await fetch("/api/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.message || "兑换失败"; return; }
    okEl.textContent = `兑换成功！获得 ${data.added} 积分，当前积分：${data.points}`;
    updatePointsDisplay(data.points);
    document.getElementById("redeem-input").value = "";
    document.getElementById("insufficient-card").hidden = true;
  } catch (err) {
    errEl.textContent = "网络错误，请稍后重试";
  }
});

// ---- Init ----
async function init() {
  await fetchConfig();
  await fetchPoints();
  // Start periodic refresh
  setInterval(fetchPoints, 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") fetchPoints();
  });
}

init();
