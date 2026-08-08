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
const referralPanel  = document.getElementById("referral-panel");
const referralBalance = document.getElementById("referral-balance");
const referralExpiry = document.getElementById("referral-expiry");
const referralFeedback = document.getElementById("referral-feedback");
const copyReferralButton = document.getElementById("copy-referral-link");
const shareReferralButton = document.getElementById("share-referral-link");

const i18n = window.TinyPDFI18n.createTranslator(document.documentElement.lang);
const t = (key, vars) => i18n.text(key, vars);

// Runtime configuration from /api/config, with defaults before initialization.
let ADS_ENABLED   = false; // Whether display ads are enabled.
let AD_CLIENT     = "";    // AdSense publisher ID.
let AD_SLOT       = "";    // AdSense slot ID.
let MAX_UPLOAD_MB = 100;   // Hard upload limit in MB.
let WEB_REQUEST_TOKEN = "";
let PAYMENT_CONFIG = { enabled: false };
let REFERRAL_CONFIG = { enabled: false };
let REFERRAL_STATUS = null;

// Submit button state
function resetSubmitButton() {
  submitButton.classList.remove("btn-compressing", "btn-disabled");
  submitButton.disabled = false;
  submitButton.textContent = t("compressButton");
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
let activeJobAccessToken = "";
let activeDownloadName = "compressed.pdf";
let activePayment = null;
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
    content: params.get("utm_content") || "",
    term: params.get("utm_term") || "",
  };
}

function trackEvent(event, data = {}, options = {}) {
  const payload = JSON.stringify({
    event,
    sessionId: getSessionId(),
    clientId: getClientId(),
    referrer: document.referrer || "",
    utm: currentUtm(),
    data: {
      landingLanguage: i18n.language,
      ...data,
    },
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

function setReferralFeedback(message) {
  if (referralFeedback) referralFeedback.textContent = message || "";
}

function formatReferralExpiry(value) {
  if (!value) return t("referralNoExpiry");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("referralNoExpiry");
  return t("referralExpiry", { date: date.toLocaleDateString(i18n.language === "zh-CN" ? "zh-CN" : "en-US") });
}

function renderReferralStatus(status) {
  REFERRAL_STATUS = status || null;
  if (!referralPanel) return;
  const enabled = Boolean(status && status.enabled && status.shareUrl);
  referralPanel.hidden = !enabled;
  if (!enabled) return;
  if (referralBalance) referralBalance.textContent = String(Number(status.balance || 0));
  if (referralExpiry) referralExpiry.textContent = formatReferralExpiry(status.nearestExpiry);
  if (copyReferralButton) copyReferralButton.textContent = t("referralCopy");
  if (shareReferralButton) shareReferralButton.textContent = t("referralShare");
}

async function refreshReferralStatus() {
  if (!REFERRAL_CONFIG.enabled || !referralPanel) return null;
  try {
    const response = await fetch(`/api/referral/status?language=${i18n.language === "zh-CN" ? "zh" : "en"}`, { cache: "no-store" });
    if (!response.ok) return null;
    const status = await response.json();
    renderReferralStatus(status);
    return status;
  } catch {
    return null;
  }
}

function trackReferralAction(event) {
  fetch("/api/referral/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, language: i18n.language === "zh-CN" ? "zh" : "en" }),
    keepalive: true,
  }).catch(() => {});
}

async function copyReferralLink() {
  const link = REFERRAL_STATUS && REFERRAL_STATUS.shareUrl;
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    const input = document.createElement("textarea");
    input.value = link;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  trackReferralAction("referral_link_copied");
  setReferralFeedback(t("referralCopied"));
}

async function shareReferralLink() {
  const link = REFERRAL_STATUS && REFERRAL_STATUS.shareUrl;
  if (!link) return;
  trackReferralAction("referral_share_clicked");
  if (navigator.share) {
    try {
      await navigator.share({ title: "TinyPDF", text: t("referralTitle"), url: link });
      setReferralFeedback(t("referralShared"));
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
  }
  await copyReferralLink();
  setReferralFeedback(t("referralShareUnavailable"));
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
    [t("metricOriginal"), formatMB(state.originalBytes)],
    [t("metricTarget"), formatMB(state.targetBytes)],
    [t("metricResult"), state.resultBytes ? formatMB(state.resultBytes) : "--"],
    [t("metricRatio"), (state.ratio != null && Number.isFinite(state.ratio)) ? ratioText(state.ratio) : "--"]
  ];
  metrics.innerHTML = rows
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

function localizeStateMessage(message) {
  const keysByMessage = {
    "File uploaded": "fileUploaded",
    "Starting compression": "startingCompression",
    "Applying stronger compression": "applyingStrongerCompression",
    "Searching for the clearest version that fits the target size...": "searchingClearest",
    "Compression complete": "statusComplete",
    "Compression failed": "statusFailed",
    "The original file is already no larger than the target size": "originalAlreadySmall",
    "The file has limited room for compression. This is the smallest usable result we could produce.": "limitedCompression",
  };
  const key = keysByMessage[message];
  return key ? t(key) : message;
}

function setStatus(state) {
  statusCard.hidden = false;
  statusTitle.textContent =
    state.status === "done"  ? t("statusComplete") :
    state.status === "error" ? t("statusFailed") : t("statusProcessing");
  const percent = Math.round((state.progress || 0) * 100);
  statusPercent.textContent = `${percent}%`;
  progressFill.style.width  = `${percent}%`;
  let msg = localizeStateMessage(state.error || state.message || "");
  if (state.status === "done" && state.rasterized) {
    msg += (msg ? " " : "") + t("rasterizedNote");
  }
  statusMessage.textContent  = msg;
  activePayment = state.payment || null;
  if (activePayment && activePayment.required) {
    downloadButton.textContent = "Pay and download";
  } else {
    downloadButton.textContent = t("downloadButton");
  }
  setMetrics(state);
  downloadRow.hidden = state.status !== "done";
}

function validateFile(file) {
  if (!file) return t("validPdf");
  if (!file.name.toLowerCase().endsWith(".pdf")) return t("pdfOnly");
  if (file.size <= 0) return t("validPdf");
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return t("fileTooLarge", { max: MAX_UPLOAD_MB });
  return "";
}

function validateTarget(file) {
  const raw = targetInput.value.trim();
  if (!raw) return t("targetRequired");
  if (!/^\d+(\.\d+)?$/.test(raw)) return t("targetNumber");
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return t("targetNumber");
  if (numeric <= 0) return t("targetPositive");
  if (file && numeric >= file.size / 1024 / 1024) return t("targetSmaller");
  return "";
}

function updateFileState(file) {
  if (!file) {
    fileMeta.textContent = t("uploadPrompt");
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
  if (!activeJobId || !activeJobAccessToken) return;
  if (activePayment && activePayment.required) {
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(activePayment.orderId)}/checkout`, {
        method: "POST",
        headers: { "X-TinyPDF-Web-Token": WEB_REQUEST_TOKEN, "X-TinyPDF-Order-Capability": activePayment.capabilityToken },
      });
      const checkout = await response.json();
      if (!response.ok) throw new Error(checkout.message || "Checkout unavailable");
      await openPaddleCheckout(checkout.transactionId);
      pollPaidDownload();
    } catch (error) { statusMessage.textContent = error.message || "Checkout unavailable"; }
    return;
  }
  const link = document.createElement("a");
  link.href = `/api/jobs/${activeJobId}/download?access=${encodeURIComponent(activeJobAccessToken)}`;
  link.download = activeDownloadName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The server settles the referral only after the download request is authorized.
  // Refresh after a short delay so the newly granted credit is visible without a reload.
  window.setTimeout(refreshReferralStatus, 500);
}

async function openPaddleCheckout(transactionId) {
  if (!PAYMENT_CONFIG.clientToken) throw new Error("Checkout is not configured");
  if (!window.Paddle) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
      script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
    });
    window.Paddle.Initialize({ token: PAYMENT_CONFIG.clientToken, environment: PAYMENT_CONFIG.environment === "sandbox" ? "sandbox" : "production" });
  }
  window.Paddle.Checkout.open({ transactionId });
}

function pollPaidDownload() {
  let attempts = 0;
  const timer = window.setInterval(async () => {
    attempts += 1;
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(activePayment.orderId)}/status`, { headers: { "X-TinyPDF-Order-Capability": activePayment.capabilityToken } });
      const state = await response.json();
      if (response.ok && state.paymentStatus === "paid" && state.fulfillmentStatus === "available") {
        window.clearInterval(timer);
        const urlResponse = await fetch(`/api/orders/${encodeURIComponent(activePayment.orderId)}/download-url`, { headers: { "X-TinyPDF-Web-Token": WEB_REQUEST_TOKEN, "X-TinyPDF-Order-Capability": activePayment.capabilityToken } });
        const payload = await urlResponse.json();
        if (urlResponse.ok) window.location.assign(payload.downloadUrl);
      }
    } catch {}
    if (attempts >= 60) window.clearInterval(timer);
  }, 2000);
}

async function submitCompression(body) {
  const response = await fetch("/api/jobs", {
    method: "POST",
    headers: {
      "X-TinyPDF-Session-Id": getSessionId(),
      "X-TinyPDF-Client-Id": getClientId(),
      "X-TinyPDF-Web-Token": WEB_REQUEST_TOKEN,
    },
    body
  });
  const payload  = await response.json();
  if (!response.ok) {
    throw new Error(
      payload.code === "WEBSITE_SESSION_REQUIRED" || payload.code === "JOB_ACCESS_DENIED"
        ? t("websiteSessionRequired")
        : (payload.message || t("serverBusy"))
    );
  }

  activeJobId = payload.id;
  activeJobAccessToken = payload.accessToken || "";
  setStatus({
    status: payload.status,
    progress: 0.06,
    message: t("checkingFile"),
    originalBytes: payload.originalBytes,
    targetBytes: payload.targetBytes,
    resultBytes: null,
    ratio: null
  });

  if (activeEvents) activeEvents.close();
  activeEvents = new EventSource(
    `/api/jobs/${payload.id}/events?access=${encodeURIComponent(activeJobAccessToken)}`
  );
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
  await configReady;

  submitButton.disabled = true;
  submitButton.classList.add("btn-compressing");
  submitButton.textContent = t("compressing");
  downloadRow.hidden = true;
  activeJobId = null;
  activeJobAccessToken = "";
  setStatus({
    status: "processing",
    progress: 0.02,
    message: t("uploadingFile"),
    originalBytes: file.size,
    targetBytes: parseFloat(targetInput.value) * 1024 * 1024,
    resultBytes: null,
    ratio: null
  });

  const body = new FormData();
  body.append("pdf", file);
  body.append("targetMB", targetInput.value.trim());
  const utm = currentUtm();
  body.append("utmSource", utm.source);
  body.append("utmMedium", utm.medium);
  body.append("utmCampaign", utm.campaign);
  body.append("utmContent", utm.content);
  body.append("utmTerm", utm.term);
  body.append("landingLanguage", i18n.language);
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
      message: error.message || t("serverBusy"),
      error: error.message || t("serverBusy"),
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
    showError(fileError, t("uploadOne"));
    return;
  }
  fileInput.files = files;
  updateFileState(files[0]);
  checkQualityWarning();
});

targetInput.addEventListener("input", () => {
  showError(targetError, validateTarget(fileInput.files?.[0]));
  checkQualityWarning();
  window.clearTimeout(targetInput.trackTimer);
  targetInput.trackTimer = window.setTimeout(() => {
    const value = Number(targetInput.value);
    if (Number.isFinite(value) && value > 0) {
      trackEvent("target_entered", { targetMB: value });
    }
  }, 500);
});

downloadButton.addEventListener("click", startDownload);
if (copyReferralButton) copyReferralButton.addEventListener("click", copyReferralLink);
if (shareReferralButton) shareReferralButton.addEventListener("click", shareReferralLink);

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

trackEvent("page_view", {
  pageLocation: window.location.href,
  pageTitle: document.title,
  landingLanguage: i18n.language,
});

trackEvent("landing_view", {
  pageLocation: window.location.href,
  pageTitle: document.title,
  landingLanguage: i18n.language,
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
      if (typeof cfg.webRequestToken === "string") WEB_REQUEST_TOKEN = cfg.webRequestToken;
      if (cfg.payment && typeof cfg.payment === "object") PAYMENT_CONFIG = cfg.payment;
      if (cfg.referral && typeof cfg.referral === "object") REFERRAL_CONFIG = cfg.referral;
    }
  } catch {
    // Keep defaults when the network request fails.
  }
  const usageDisplay = document.getElementById("usage-display");
  if (usageDisplay) {
    usageDisplay.textContent = t("uploadLimit", { max: MAX_UPLOAD_MB });
  }
  // Initialize the display ad slot only when ads are enabled and configured.
  if (window.initAdSlot) {
    window.initAdSlot("ad-slot-main", { adsEnabled: ADS_ENABLED, adClient: AD_CLIENT, adSlot: AD_SLOT });
  }
  await refreshReferralStatus();
}

submitButton.textContent = t("compressButton");
downloadButton.textContent = t("downloadButton");
const configReady = initConfig();

window.addEventListener("focus", () => { refreshReferralStatus(); });
