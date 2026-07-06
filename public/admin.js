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
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
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

function formatTargetSize(row) {
  if (row && row.targetMB) return `${Number(row.targetMB).toLocaleString("zh-CN")} MB`;
  return formatBytes(row && row.targetBytes);
}

function formatTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleString();
}

function sourceFor(event) {
  if (event.utm && event.utm.source) return event.utm.source;
  if (!event.referrer) return "直接访问";
  try {
    return new URL(event.referrer).hostname.replace(/^www\./, "");
  } catch {
    return "其他";
  }
}

function eventLabel(value) {
  const labels = {
    page_view: "页面访问",
    file_selected: "选择文件",
    compress_started: "开始压缩",
    compress_success: "压缩成功",
    compress_error: "压缩失败",
    download_clicked: "点击下载",
    session_end: "会话结束",
  };
  return labels[value] || value || "-";
}

function categoryLabel(value) {
  const labels = {
    presentation: "演示文稿",
    design: "设计作品",
    resume: "简历",
    document: "文档",
    academic: "学术资料",
    scan: "扫描件",
    other: "其他",
  };
  return labels[value] || value || "其他";
}

function deviceLabel(value) {
  const labels = { desktop: "桌面端", mobile: "移动端" };
  return labels[value] || value || "-";
}

function funnelLabel(value) {
  const labels = {
    page_view: "页面访问",
    file_selected: "已选择文件",
    compress_started: "开始压缩",
    compress_success: "压缩成功",
    download_clicked: "点击下载",
  };
  return labels[value] || value.replace(/_/g, " ");
}

function renderStats(summary) {
  const items = [
    ["今日浏览量", summary.overview.todayPageViews],
    ["7 天浏览量", summary.overview.pageViews7d],
    ["30 天浏览量", summary.overview.pageViews30d],
    ["7 天访客", summary.overview.uniqueVisitors7d],
    ["今日压缩", summary.overview.todayCompressions],
    ["今日下载", summary.overview.todayDownloads],
    ["成功率", formatPercent(summary.overview.successRate7d)],
    ["平均停留", `${summary.behavior.averageDwellSeconds || 0} 秒`],
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
    el.innerHTML = `<div class="empty-state">暂无数据</div>`;
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
    step: funnelLabel(step),
    count,
  }));
  renderList("funnel-list", rows, "step");
}

function renderCompression(summary) {
  const rows = [
    { label: "达到目标", value: `${summary.compression.reachedTargetRate}%` },
    { label: "栅格化", value: `${summary.compression.rasterizedRate}%` },
    { label: "错误", value: formatNumber((summary.compression.errorReasons || []).reduce((sum, item) => sum + item.count, 0)) },
  ];
  document.getElementById("compression-list").innerHTML = rows.map(row => `
    <div class="metric-line"><span>${text(row.label)}</span><strong>${text(row.value)}</strong></div>
  `).join("");
}

function renderPromotions(summary) {
  const rows = summary.acquisition.promotions || [];
  document.getElementById("promotion-rows").innerHTML = rows.length ? rows.slice(0, 20).map(row => `
    <tr>
      <td>${text(row.source || "-")}</td>
      <td>${text(row.content || "-")}</td>
      <td>${text(row.campaign || "-")}</td>
      <td>${text(formatNumber(row.visits))}</td>
      <td>${text(formatNumber(row.visitors))}</td>
      <td>${text(formatNumber(row.compressions))}</td>
      <td>${text(formatNumber(row.downloads))}</td>
    </tr>
  `).join("") : `<tr><td colspan="7">暂无推广来源数据。后续推广链接请带 utm_source、utm_campaign、utm_content。</td></tr>`;
}

function renderRecentFiles(summary) {
  const rows = summary.files.recentFileNames || [];
  document.getElementById("recent-files").innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td>${text(formatTime(row.ts))}</td>
      <td>${text(row.fileName)}</td>
      <td>${text(categoryLabel(row.category))}</td>
      <td>${text(formatBytes(row.fileBytes))}</td>
      <td>${text(formatTargetSize(row))}</td>
      <td>${text(formatBytes(row.resultBytes))}</td>
    </tr>
  `).join("") : `<tr><td colspan="6">暂无上传文件名</td></tr>`;
}

function renderRecentEvents(summary) {
  const rows = summary.recentEvents || [];
  document.getElementById("recent-events").innerHTML = rows.length ? rows.map(event => {
    const data = event.data || {};
    const details = [
      data.fileName ? `文件：${data.fileName}` : "",
      data.fileCategory ? `分类：${categoryLabel(data.fileCategory)}` : "",
      data.reason ? `原因：${data.reason}` : "",
    ].filter(Boolean).join(" | ");
    return `
      <tr>
        <td>${text(formatTime(event.ts))}</td>
        <td>${text(eventLabel(event.event))}</td>
        <td>${text(sourceFor(event))}</td>
        <td>${text(event.country || "Unknown")}</td>
        <td>${text(deviceLabel(event.device))}</td>
        <td>${text(details || "-")}</td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="6">暂无事件</td></tr>`;
}

function render(summary) {
  renderStats(summary);
  renderList("sources-list", summary.acquisition.sources || [], "source");
  renderList("regions-list", summary.geo && summary.geo.regions || [], "region");
  renderFunnel(summary);
  renderList("file-categories", (summary.files.categories || []).map(row => ({ ...row, category: categoryLabel(row.category) })), "category");
  renderCompression(summary);
  renderPromotions(summary);
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
  if (!response.ok) throw new Error("无法加载数据");
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
    showError(payload.message || "登录失败");
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
