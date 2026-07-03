"use strict";

const loginPanel = document.getElementById("login-panel");
const loginForm = document.getElementById("login-form");
const passwordInput = document.getElementById("admin-password");
const loginError = document.getElementById("login-error");
const dashboard = document.getElementById("dashboard");
const logoutButton = document.getElementById("logout-button");
const refreshButton = document.getElementById("refresh-button");

function showError(message) {
  loginError.hidden = !message;
  loginError.textContent = message || "";
}

function text(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en").format(Number(value || 0));
}

function formatPercent(value) {
  return `${Number(value || 0)}%`;
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return "-";
  const mb = n / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

function formatTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleString();
}

function sourceFor(event) {
  if (event.utm && event.utm.source) return event.utm.source;
  if (!event.referrer) return "Direct";
  try {
    return new URL(event.referrer).hostname.replace(/^www\./, "");
  } catch {
    return "Other";
  }
}

function renderStats(summary) {
  const items = [
    ["Today views", summary.overview.todayPageViews],
    ["7-day views", summary.overview.pageViews7d],
    ["30-day views", summary.overview.pageViews30d],
    ["7-day visitors", summary.overview.uniqueVisitors7d],
    ["Today compressions", summary.overview.todayCompressions],
    ["Today downloads", summary.overview.todayDownloads],
    ["Success rate", formatPercent(summary.overview.successRate7d)],
    ["Avg. dwell", `${summary.behavior.averageDwellSeconds || 0}s`],
  ];
  document.getElementById("overview-grid").innerHTML = items.map(([label, value]) => `
    <div class="stat-card">
      <span>${text(label)}</span>
      <strong>${text(value)}</strong>
    </div>
  `).join("");
}

function renderList(id, rows, labelKey, valueKey = "count") {
  const el = document.getElementById(id);
  if (!rows || rows.length === 0) {
    el.innerHTML = `<div class="empty-state">No data yet</div>`;
    return;
  }
  const max = Math.max(...rows.map(row => Number(row[valueKey] || 0)), 1);
  el.innerHTML = rows.slice(0, 8).map(row => {
    const value = Number(row[valueKey] || 0);
    return `
      <div class="mini-row">
        <span>${text(row[labelKey])}</span>
        <div class="mini-bar"><i style="width:${Math.max(4, Math.round(value / max * 100))}%"></i></div>
        <strong>${formatNumber(value)}</strong>
      </div>
    `;
  }).join("");
}

function renderFunnel(summary) {
  const rows = Object.entries(summary.funnel).map(([step, count]) => ({
    step: step.replace(/_/g, " "),
    count,
  }));
  renderList("funnel-list", rows, "step");
}

function renderCompression(summary) {
  const rows = [
    { label: "Reached target", value: `${summary.compression.reachedTargetRate}%` },
    { label: "Rasterized", value: `${summary.compression.rasterizedRate}%` },
    { label: "Errors", value: formatNumber((summary.compression.errorReasons || []).reduce((sum, item) => sum + item.count, 0)) },
  ];
  document.getElementById("compression-list").innerHTML = rows.map(row => `
    <div class="metric-line"><span>${text(row.label)}</span><strong>${text(row.value)}</strong></div>
  `).join("");
}

function renderRecentFiles(summary) {
  const rows = summary.files.recentFileNames || [];
  document.getElementById("recent-files").innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td>${text(formatTime(row.ts))}</td>
      <td>${text(row.fileName)}</td>
      <td>${text(row.category)}</td>
      <td>${text(formatBytes(row.fileBytes))}</td>
    </tr>
  `).join("") : `<tr><td colspan="4">No uploaded file names yet</td></tr>`;
}

function renderRecentEvents(summary) {
  const rows = summary.recentEvents || [];
  document.getElementById("recent-events").innerHTML = rows.length ? rows.map(event => {
    const data = event.data || {};
    const details = [
      data.fileName ? `file: ${data.fileName}` : "",
      data.fileCategory ? `category: ${data.fileCategory}` : "",
      data.reason ? `reason: ${data.reason}` : "",
    ].filter(Boolean).join(" | ");
    return `
      <tr>
        <td>${text(formatTime(event.ts))}</td>
        <td>${text(event.event)}</td>
        <td>${text(sourceFor(event))}</td>
        <td>${text(event.device || "-")}</td>
        <td>${text(details || "-")}</td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="5">No events yet</td></tr>`;
}

function render(summary) {
  renderStats(summary);
  renderList("sources-list", summary.acquisition.sources || [], "source");
  renderFunnel(summary);
  renderList("file-categories", summary.files.categories || [], "category");
  renderCompression(summary);
  renderRecentFiles(summary);
  renderRecentEvents(summary);
}

async function loadSummary() {
  const response = await fetch("/api/admin/summary", { credentials: "same-origin" });
  if (response.status === 401) {
    dashboard.hidden = true;
    loginPanel.hidden = false;
    logoutButton.hidden = true;
    return;
  }
  if (!response.ok) throw new Error("Could not load analytics");
  render(await response.json());
  loginPanel.hidden = true;
  dashboard.hidden = false;
  logoutButton.hidden = false;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  const response = await fetch("/api/admin/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: passwordInput.value }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    showError(payload.message || "Login failed");
    return;
  }
  passwordInput.value = "";
  await loadSummary();
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
  dashboard.hidden = true;
  loginPanel.hidden = false;
  logoutButton.hidden = true;
});

refreshButton.addEventListener("click", loadSummary);
loadSummary().catch(error => showError(error.message));
