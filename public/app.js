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
const payCard = document.getElementById("pay-card");
const payMessage = document.getElementById("pay-message");
const packageList = document.getElementById("package-list");
const paymentList = document.getElementById("payment-list");
const homepagePackages = document.getElementById("homepage-packages");
const paidButton = document.getElementById("paid-button");
const supportCopy = document.getElementById("support-copy");
const supportEmailLink = document.getElementById("support-email-link");

let appConfig = null;
let activeEvents = null;
let activeJobId = null;
let activeDownloadName = "compressed.pdf";
let activeDownloadUrl = "";
let activePackageId = null;
let lastRequest = null;

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

async function track(type, payload = {}) {
  return fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, ...payload })
  }).catch(() => {});
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
  if (appConfig.freeUsageEnabled) {
    const remain = appConfig.freeRemaining == null ? "不限" : `${appConfig.freeRemaining} 次剩余`;
    chips.push(`<span class="chip">免费次数：${appConfig.freeUsageLimit} 次 · ${remain}</span>`);
    chips.push(`<span class="chip">统计规则：${appConfig.freeUsageResetMode === "daily" ? "按日重置" : "永久累计"}</span>`);
  }
  if (appConfig.billingEnabled) {
    chips.push('<span class="chip">收费能力已开启</span>');
  }
  configBar.innerHTML = chips.join("");
}

function renderPackages(target, packages) {
  target.innerHTML = packages.length
    ? packages.map((pkg) => `
      <article class="package-card ${pkg.id === activePackageId ? "is-selected" : ""}">
        <div class="package-head">
          <h3>${pkg.name}</h3>
          <strong>¥${Number(pkg.priceCny).toFixed(2)}</strong>
        </div>
        <p>${pkg.description || ""}</p>
        <p class="muted-text">${pkg.entitlementType === "duration_days" ? `${pkg.entitlementValue} 天时长` : `${pkg.entitlementValue} 次压缩`}</p>
        <div class="action-row">
          ${pkg.buyLink ? `<a class="button-link" data-buy-link="${pkg.buyLink}" data-package-id="${pkg.id}" href="${pkg.buyLink}" target="_blank" rel="noreferrer">前往购买</a>` : `<button type="button" class="secondary-button select-package" data-package-id="${pkg.id}">选中此套餐</button>`}
          ${pkg.buyLink ? `<button type="button" class="secondary-button select-package" data-package-id="${pkg.id}">购买后选择</button>` : ""}
        </div>
      </article>
    `).join("")
    : '<p class="muted-text">当前暂无可购买套餐。</p>';
}

function renderPaymentMethods(methods) {
  paymentList.innerHTML = methods.length
    ? methods.map((item) => `
      <article class="payment-card">
        <h3>${item.name}</h3>
        ${item.link ? `<p><a class="button-link" href="${item.link}" target="_blank" rel="noreferrer">打开支付链接</a></p>` : ""}
        ${item.qrCodeUrl ? `<p><a class="button-link" href="${item.qrCodeUrl}" target="_blank" rel="noreferrer">查看收款二维码</a></p>` : ""}
        <p>${item.instructions || ""}</p>
        <p class="muted-text">${item.postPaymentInstructions || ""}</p>
      </article>
    `).join("")
    : '<p class="muted-text">当前暂无可用收款方式。</p>';
}

function refreshPublicUi() {
  renderConfigBar();

  // 只在开启收费时显示套餐面板
  const packagePanel = document.getElementById("package-panel");
  if (packagePanel) {
    packagePanel.hidden = !appConfig?.billingEnabled;
  }

  renderPackages(homepagePackages, appConfig?.packages || []);
  renderPackages(packageList, appConfig?.packages || []);
  renderPaymentMethods(appConfig?.paymentMethods || []);
  supportCopy.textContent = appConfig?.supportMessage || "";
  supportEmailLink.textContent = appConfig?.supportEmail || "zijinnmengli@gmail.com";
  supportEmailLink.href = `mailto:${appConfig?.supportEmail || "zijinnmengli@gmail.com"}`;
}

async function fetchConfig() {
  const response = await fetch("/api/config");
  appConfig = await response.json();
  refreshPublicUi();
}

function setPaymentCard(message) {
  payCard.hidden = false;
  payMessage.textContent = message || "免费次数已用完，请购买后继续使用";
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
  await track("download_click", { jobId: activeJobId });
  const link = document.createElement("a");
  link.href = activeDownloadUrl || `/api/jobs/${activeJobId}/download`;
  link.download = activeDownloadName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function unlockPaidUse() {
  paidButton.disabled = true;
  try {
    const response = await fetch("/api/payments/manual-unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId: activePackageId })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || "如您已支付但未生效，请联系客服处理");
    }
    appConfig = payload.config;
    refreshPublicUi();
    payCard.hidden = true;
    if (lastRequest) {
      const retryBody = new FormData();
      retryBody.append("pdf", lastRequest.file);
      retryBody.append("targetMB", String(lastRequest.targetMB));
      await submitCompression(retryBody);
    }
  } catch (error) {
    setPaymentCard(error.message);
  } finally {
    paidButton.disabled = false;
  }
}

async function submitCompression(body) {
  const response = await fetch("/api/jobs", { method: "POST", body });
  const payload = await response.json();
  if (response.status === 402) {
    appConfig = payload.config;
    refreshPublicUi();
    setPaymentCard(payload.message);
    submitButton.disabled = false;
    submitButton.textContent = "开始压缩";
    return;
  }
  if (!response.ok) {
    throw new Error(payload.message || "服务器繁忙，请稍后重试");
  }

  appConfig = payload.config;
  refreshPublicUi();
  payCard.hidden = true;
  activeJobId = payload.id;
  activeDownloadUrl = payload.downloadUrl || "";
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
    activeDownloadUrl = state.downloadUrl || activeDownloadUrl;
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

fileInput.addEventListener("click", () => track("upload_click"));
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  updateFileState(file);
  if (file && !validateFile(file)) {
    await track("upload_success", { fileName: file.name, fileBytes: file.size });
  } else if (file) {
    await track("upload_failure", { fileName: file.name, fileBytes: file.size });
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
    await track("upload_failure", { message: "multi_file_drop" });
    return;
  }
  fileInput.files = files;
  const file = files[0];
  updateFileState(file);
  if (!validateFile(file)) {
    await track("upload_success", { fileName: file.name, fileBytes: file.size });
  } else {
    await track("upload_failure", { fileName: file.name, fileBytes: file.size });
  }
});

targetInput.addEventListener("input", async () => {
  const error = validateTarget(fileInput.files?.[0]);
  showError(targetError, error);
  if (!error && targetInput.value.trim()) {
    await track("target_size_input", { targetMB: Number(targetInput.value) });
  }
});

downloadButton.addEventListener("click", startDownload);
paidButton.addEventListener("click", unlockPaidUse);

document.addEventListener("click", async (event) => {
  const link = event.target.closest("[data-buy-link]");
  const picker = event.target.closest(".select-package");
  if (picker) {
    activePackageId = picker.getAttribute("data-package-id");
    refreshPublicUi();
    return;
  }
  if (link) {
    activePackageId = link.getAttribute("data-package-id");
    await track("purchase_click", { packageId: activePackageId });
  }
});

supportEmailLink.addEventListener("click", () => {
  track("support_click", { message: "footer_email" });
});

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
  payCard.hidden = true;
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

  if (appConfig?.billingEnabled && appConfig?.freeUsageEnabled && (appConfig.freeRemaining ?? 0) <= 0 && !appConfig.paidCredits && !appConfig.memberActive) {
    setPaymentCard("免费次数已用完，请购买后继续使用");
    submitButton.disabled = false;
    submitButton.textContent = "开始压缩";
    return;
  }

  const body = new FormData();
  body.append("pdf", file);
  body.append("targetMB", targetInput.value.trim());
  lastRequest = { file, targetMB: Number(targetInput.value.trim()) };

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

window.addEventListener("DOMContentLoaded", async () => {
  await fetchConfig();
  await track("page_visit");
  if (appConfig?.billingEnabled) {
    await track("package_view");
  }
});
