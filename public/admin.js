"use strict";

const loginPanel = document.getElementById("login-panel");
const loginForm = document.getElementById("login-form");
const passwordInput = document.getElementById("admin-password");
const loginError = document.getElementById("login-error");
const dashboard = document.getElementById("dashboard");
const logoutButton = document.getElementById("logout-button");
const refreshButton = document.getElementById("refresh-button");
const refreshStatus = document.getElementById("refresh-status");
const dateRangeCopy = document.getElementById("date-range-copy");

function showError(message) {
  loginError.hidden = !message;
  loginError.textContent = message || "";
}

function setRefreshStatus(state, message) {
  if (!refreshStatus) return;
  refreshStatus.classList.remove("is-loading", "is-success", "is-error");
  if (state) refreshStatus.classList.add(`is-${state}`);
  refreshStatus.textContent = message;
}

function setRefreshLoading(isLoading) {
  if (refreshButton) {
    refreshButton.disabled = isLoading;
    refreshButton.textContent = isLoading ? "刷新中" : "刷新数据";
  }
  if (dashboard) {
    dashboard.classList.toggle("is-refreshing", isLoading);
  }
}

function refreshedAtMessage() {
  const time = new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `上次更新：${time}`;
}

function text(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attr(value) {
  return text(value).replace(/'/g, "&#39;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
}

function formatPercent(value) {
  return `${Number(value || 0)}%`;
}

function formatSigned(value) {
  const n = Number(value || 0);
  if (n > 0) return `+${formatNumber(n)}`;
  return formatNumber(n);
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
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
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

function statusLabel(value) {
  const labels = { success: "成功", error: "失败", processing: "处理中", timeout: "超时/中断", pending: "待处理" };
  return labels[value] || "成功";
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

function metricCard(label, value, comparison, footnote) {
  const percent = comparison && comparison.percent ? `${comparison.percent > 0 ? "+" : ""}${comparison.percent}%` : "0%";
  const delta = comparison ? formatSigned(comparison.delta) : "+0";
  return `
    <article class="admin-metric-card">
      <div class="admin-metric-top"><span>${text(label)}</span><em>${text(percent)}</em></div>
      <strong>${text(value)}</strong>
      <p>${text(footnote || `较上一周期 ${delta}`)}</p>
    </article>
  `;
}

function renderStats(summary) {
  const comparisons = summary.overview.comparisons || {};
  const items = [
    metricCard("页面浏览量", formatNumber(summary.overview.pageViews30d), comparisons.pageViews30d),
    metricCard("独立访客", formatNumber(summary.overview.uniqueVisitors30d || summary.overview.uniqueVisitors7d), comparisons.uniqueVisitors30d),
    metricCard("压缩任务", formatNumber(summary.funnel.compress_success), comparisons.compressSuccess30d, `成功率 ${summary.overview.successRate7d || 0}%`),
    metricCard("文件下载", formatNumber(summary.funnel.download_clicked), comparisons.downloads30d, `下载转化率 ${downloadRate(summary)}%`),
  ];
  document.getElementById("overview-grid").innerHTML = items.join("");
  document.getElementById("secondary-grid").innerHTML = [
    ["今日浏览量", formatNumber(summary.overview.todayPageViews)],
    ["7 天浏览量", formatNumber(summary.overview.pageViews7d)],
    ["7 天访客", formatNumber(summary.overview.uniqueVisitors7d)],
    ["今日压缩", formatNumber(summary.overview.todayCompressions)],
    ["今日下载", formatNumber(summary.overview.todayDownloads)],
    ["平均停留", `${summary.behavior.averageDwellSeconds || 0} 秒`],
    ["压缩用时", `${summary.behavior.averageCompressionSeconds || 0} 秒`],
  ].map(([label, value]) => `<div><span>${text(label)}</span><strong>${text(value)}</strong></div>`).join("");

  const daily = summary.trends && summary.trends.daily || [];
  if (daily.length) {
    dateRangeCopy.textContent = `数据区间：${daily[0].date.replace(/-/g, "/")} — ${daily[daily.length - 1].date.replace(/-/g, "/")}`;
  }
}

function downloadRate(summary) {
  const views = Number(summary.funnel.page_view || 0);
  return views ? Math.round((Number(summary.funnel.download_clicked || 0) / views) * 1000) / 10 : 0;
}

function pointsFor(rows, key, width, height, padX, padY, maxValue) {
  if (!rows.length) return "";
  const span = Math.max(rows.length - 1, 1);
  return rows.map((row, index) => {
    const x = padX + (index / span) * (width - padX * 2);
    const y = padY + (1 - Number(row[key] || 0) / maxValue) * (height - padY * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function renderTrend(summary) {
  const rows = summary.trends && summary.trends.daily || [];
  const el = document.getElementById("trend-chart");
  if (!rows.length) {
    el.innerHTML = `<div class="empty-state">暂无趋势数据</div>`;
    return;
  }
  const width = 680;
  const height = 260;
  const padX = 42;
  const padY = 24;
  const maxValue = Math.max(1, ...rows.flatMap(row => [Number(row.pageViews || 0), Number(row.visitors || 0)]));
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map(ratio => Math.round(maxValue * ratio));
  const pagePoints = pointsFor(rows, "pageViews", width, height, padX, padY, maxValue);
  const visitorPoints = pointsFor(rows, "visitors", width, height, padX, padY, maxValue);
  const labelStep = Math.max(1, Math.ceil(rows.length / 6));
  el.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="访问趋势图">
      ${yTicks.map((tick, index) => {
        const y = padY + index * ((height - padY * 2) / (yTicks.length - 1));
        return `<line x1="${padX}" x2="${width - padX}" y1="${y}" y2="${y}"/><text x="10" y="${y + 4}">${tick}</text>`;
      }).join("")}
      <polyline class="chart-fill" points="${pagePoints} ${width - padX},${height - padY} ${padX},${height - padY}" />
      <polyline class="chart-line is-page" points="${pagePoints}" />
      <polyline class="chart-line is-visitor" points="${visitorPoints}" />
      ${rows.map((row, index) => index % labelStep === 0 || index === rows.length - 1 ? `<text class="x-label" x="${padX + (index / Math.max(rows.length - 1, 1)) * (width - padX * 2)}" y="${height - 4}">${text(row.label)}</text>` : "").join("")}
    </svg>
  `;
}

function renderFunnel(summary) {
  const entries = Object.entries(summary.funnel).map(([step, count]) => ({ step, label: funnelLabel(step), count: Number(count || 0) }));
  const base = Number(entries[0] && entries[0].count || 0);
  document.getElementById("funnel-list").innerHTML = entries.map(row => {
    const percent = base > 0 ? Math.round((row.count / base) * 1000) / 10 : 0;
    return `
      <div class="admin-funnel-row">
        <div><span>${text(row.label)}</span><strong>${formatNumber(row.count)}</strong><em>${percent}%</em></div>
        <i style="width:${base > 0 ? Math.max(2, percent) : 0}%"></i>
      </div>
    `;
  }).join("");
}

function renderSources(summary) {
  const rows = (summary.acquisition.sources || []).slice(0, 4);
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  if (!rows.length) {
    document.getElementById("sources-list").innerHTML = `<div class="empty-state">暂无数据</div>`;
    return;
  }
  let cursor = 0;
  const colors = ["#111111", "#62625f", "#aaa9a3", "#e4e4df"];
  const gradient = rows.map((row, index) => {
    const value = total ? (Number(row.count || 0) / total) * 100 : 0;
    const start = cursor;
    cursor += value;
    return `${colors[index]} ${start}% ${cursor}%`;
  }).join(", ");
  document.getElementById("sources-list").innerHTML = `
    <div class="source-donut" style="--donut:${attr(gradient)}"><strong>${formatNumber(total)}</strong><span>总访问</span></div>
    <div class="source-legend">
      ${rows.map((row, index) => {
        const percent = total ? Math.round((Number(row.count || 0) / total) * 100) : 0;
        return `<div><i style="background:${colors[index]}"></i><span>${text(row.source)}</span><strong>${percent}%</strong></div>`;
      }).join("")}
    </div>
  `;
}

function renderBarList(id, rows, labelKey, valueKey = "count") {
  const el = document.getElementById(id);
  if (!rows || rows.length === 0) {
    el.innerHTML = `<div class="empty-state">暂无数据</div>`;
    return;
  }
  const max = Math.max(...rows.map(row => Number(row[valueKey] || 0)), 1);
  const total = rows.reduce((sum, row) => sum + Number(row[valueKey] || 0), 0);
  el.innerHTML = rows.slice(0, 5).map(row => {
    const value = Number(row[valueKey] || 0);
    return `
      <div class="admin-bar-row">
        <span>${text(row[labelKey])}</span>
        <i><b style="width:${Math.max(4, Math.round(value / max * 100))}%"></b></i>
        <strong>${formatNumber(value)}</strong>
      </div>
    `;
  }).join("") + `<small>总计 ${formatNumber(total)} 份文件</small>`;
}

function renderCompression(summary) {
  const errors = (summary.compression.errorReasons || []).reduce((sum, item) => sum + Number(item.count || 0), 0);
  document.getElementById("compression-list").innerHTML = `
    <div class="compression-ring"><strong>${summary.overview.successRate7d || 0}%</strong><span>成功率</span></div>
    <div class="compression-stats">
      <span>平均耗时</span><strong>${summary.behavior.averageCompressionSeconds || 0} 秒</strong>
      <span>平均节省</span><strong>${summary.compression.averageSavingsRate || 0}%</strong>
      <span>错误任务</span><strong>${formatNumber(errors)}</strong>
    </div>
  `;
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
  const rows = (summary.files.recentFileNames || []).slice(0, 5);
  document.getElementById("recent-files").innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td>${text(formatTime(row.ts))}</td>
      <td class="file-name-cell">${text(row.fileName)}</td>
      <td>${text(categoryLabel(row.category))}</td>
      <td>${text(formatBytes(row.fileBytes))}</td>
      <td>${text(formatTargetSize(row))}</td>
      <td><strong>${text(formatBytes(row.resultBytes))}</strong></td>
      <td title="${attr(row.reason || "")}"><span class="status-tag is-${attr(row.status || "success")}">${text(statusLabel(row.status))}</span></td>
    </tr>
  `).join("") : `<tr><td colspan="7">暂无上传文件名</td></tr>`;
}

function renderRecentEvents(summary) {
  const rows = summary.recentEvents || [];
  document.getElementById("recent-events").innerHTML = rows.length ? rows.slice(0, 30).map(event => {
    const data = event.data || {};
    const details = [
      data.fileName ? `文件：${data.fileName}` : "",
      data.fileCategory ? `分类：${categoryLabel(data.fileCategory)}` : "",
      data.reason ? `原因：${data.reason}` : "",
      data.code ? `错误码：${data.code}` : "",
      data.phase ? `阶段：${data.phase}` : "",
      Number.isFinite(Number(data.elapsedMs)) ? `耗时：${Math.round(Number(data.elapsedMs) / 1000)} 秒` : "",
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
  renderTrend(summary);
  renderFunnel(summary);
  renderSources(summary);
  renderBarList("regions-list", summary.geo && summary.geo.regions || [], "region");
  renderBarList("file-categories", (summary.files.categories || []).map(row => ({ ...row, category: categoryLabel(row.category) })), "category");
  renderCompression(summary);
  renderPromotions(summary);
  renderRecentFiles(summary);
  renderRecentEvents(summary);
}

async function loadSummary({ manual = false } = {}) {
  if (manual) {
    setRefreshStatus("loading", "数据更新中，请稍候...");
  }
  setRefreshLoading(true);
  try {
    const response = await fetch(`/api/admin/summary?ts=${Date.now()}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.status === 401) {
      dashboard.hidden = true;
      loginPanel.hidden = false;
      logoutButton.hidden = true;
      setRefreshStatus("", "上次更新：等待登录");
      return;
    }
    if (!response.ok) throw new Error("无法加载数据");
    render(await response.json());
    loginPanel.hidden = true;
    dashboard.hidden = false;
    logoutButton.hidden = false;
    setRefreshStatus("success", refreshedAtMessage());
  } catch (error) {
    setRefreshStatus("error", `刷新失败：${error.message || "请稍后重试"}`);
    throw error;
  } finally {
    setRefreshLoading(false);
  }
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

refreshButton.addEventListener("click", () => {
  loadSummary({ manual: true }).catch(error => showError(error.message));
});
loadSummary().catch(error => showError(error.message));
