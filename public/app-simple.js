// DOM references
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

// Runtime configuration from /api/config, with defaults before initialization.
let ADS_ENABLED   = false; // Whether display ads are enabled.
let AD_CLIENT     = "";    // AdSense publisher ID.
let AD_SLOT       = "";    // AdSense slot ID.
let MAX_UPLOAD_MB = 100;   // Hard upload limit in MB.

// Submit button state
function resetSubmitButton() {
  submitButton.classList.remove("btn-compressing", "btn-disabled");
  submitButton.disabled = false;
  submitButton.textContent = "Compress PDF";
}

// Quality warning bubble
// Warn when target size is below 15% of the original file, but do not block compression.
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

// Utilities
let activeEvents       = null;
let activeJobId        = null;
let activeDownloadName = "compressed.pdf";
let lastTrackedFileSignature = "";
const pageStartedAt = Date.now();

function getClientId() {
  const key = "tinypdf_client_id";
  try {
    let value = localStorage.getItem(key);
    if (!value) {
      value = `${Math.floor(Math.random() * 1e9)}.${Math.floor(Date.now() / 1000)}`;
      localStorage.setItem(key, value);
    }
    return value;
  } catch {
    return `${Math.floor(Math.random() * 1e9)}.${Math.floor(Date.now() / 1000)}`;
  }
}

function getSessionId() {
  const key = "tinypdf_session_id";
  try {
    let value = sessionStorage.getItem(key);
    if (!value) {
      value = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      sessionStorage.setItem(key, value);
    }
    return value;
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
}

function currentUtm() {
  const params = new URLSearchParams(window.location.search);
  return {
    source: params.get("utm_source") || "",
    medium: params.get("utm_medium") || "",
    campaign: params.get("utm_campaign") || "",
  };
}

function trackEvent(event, data = {}, options = {}) {
  const payload = JSON.stringify({
    event,
    sessionId: getSessionId(),
    clientId: getClientId(),
    referrer: document.referrer || "",
    utm: currentUtm(),
    data,
  });
  if (options.beacon && navigator.sendBeacon) {
    navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
    return;
  }
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: Boolean(options.keepalive),
  }).catch(() => {});
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
    ["Original size", formatMB(state.originalBytes)],
    ["Target size", formatMB(state.targetBytes)],
    ["Compressed size", state.resultBytes ? formatMB(state.resultBytes) : "--"],
    ["Compression ratio", (state.ratio != null && Number.isFinite(state.ratio)) ? ratioText(state.ratio) : "--"]
  ];
  metrics.innerHTML = rows
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

function setStatus(state) {
  statusCard.hidden = false;
  statusTitle.textContent =
    state.status === "done"  ? "Compression complete" :
    state.status === "error" ? "Compression failed" : "Processing";
  const percent = Math.round((state.progress || 0) * 100);
  statusPercent.textContent = `${percent}%`;
  progressFill.style.width  = `${percent}%`;
  let msg = state.error || state.message || "";
  if (state.status === "done" && state.rasterized) {
    msg += (msg ? " " : "") + "Note: to reach the target size, pages were converted to images, so sharpness may be lower.";
  }
  statusMessage.textContent  = msg;
  setMetrics(state);
  downloadRow.hidden = state.status !== "done";
}

function validateFile(file) {
  if (!file) return "Please choose a valid PDF file";
  if (!file.name.toLowerCase().endsWith(".pdf")) return "Only PDF files are supported";
  if (file.size <= 0) return "Please choose a valid PDF file";
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return `File is too large. The current limit is ${MAX_UPLOAD_MB}MB`;
  return "";
}

function validateTarget(file) {
  const raw = targetInput.value.trim();
  if (!raw) return "Enter a target file size";
  if (!/^\d+(\.\d+)?$/.test(raw)) return "Enter a valid number";
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return "Enter a valid number";
  if (numeric <= 0) return "Target size must be greater than 0";
  if (file && numeric >= file.size / 1024 / 1024) return "Target size must be smaller than the original file";
  return "";
}

function updateFileState(file) {
  if (!file) {
    fileMeta.textContent = "Drag a file here, or click to choose one";
    showError(fileError, "");
    return;
  }
  fileMeta.textContent = `${file.name} · ${formatMB(file.size)}`;
  showError(fileError, validateFile(file));
  const signature = `${file.name}:${file.size}:${file.lastModified || 0}`;
  if (signature !== lastTrackedFileSignature) {
    lastTrackedFileSignature = signature;
    trackEvent("file_selected", {
      fileName: file.name,
      fileBytes: file.size,
    });
  }
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
  if (!response.ok) throw new Error(payload.message || "The server is busy. Please try again later.");

  activeJobId = payload.id;
  setStatus({
    status: payload.status,
    progress: 0.06,
    message: "Checking the file",
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
  submitButton.textContent = "Compressing...";
  downloadRow.hidden = true;
  setStatus({
    status: "processing",
    progress: 0.02,
    message: "Uploading the file",
    originalBytes: file.size,
    targetBytes: parseFloat(targetInput.value) * 1024 * 1024,
    resultBytes: null,
    ratio: null
  });

  const body = new FormData();
  body.append("pdf", file);
  body.append("targetMB", targetInput.value.trim());
  trackEvent("compress_started", {
    fileName: file.name,
    fileBytes: file.size,
    targetMB: Number(targetInput.value.trim()),
  });

  try {
    await submitCompression(body);
  } catch (error) {
    setStatus({
      status: "error",
      progress: 1,
      message: error.message || "The server is busy. Please try again later.",
      error: error.message || "The server is busy. Please try again later.",
      originalBytes: file.size,
      targetBytes: parseFloat(targetInput.value) * 1024 * 1024,
      resultBytes: null,
      ratio: null
    });
    resetSubmitButton();
  }
}

// Event listeners
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
    showError(fileError, "Please upload one PDF file at a time");
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

window.addEventListener("pagehide", () => {
  trackEvent("session_end", {
    dwellSeconds: Math.max(0, Math.round((Date.now() - pageStartedAt) / 1000)),
  }, { beacon: true });
});

// Initialization: load runtime configuration from the server.
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
    // Keep defaults when the network request fails.
  }
  const usageDisplay = document.getElementById("usage-display");
  if (usageDisplay) {
    usageDisplay.textContent = `Free unlimited use · One file up to ${MAX_UPLOAD_MB}MB`;
  }
  // Initialize the display ad slot only when ads are enabled and configured.
  if (window.initAdSlot) {
    window.initAdSlot("ad-slot-main", { adsEnabled: ADS_ENABLED, adClient: AD_CLIENT, adSlot: AD_SLOT });
  }
}

initConfig();
