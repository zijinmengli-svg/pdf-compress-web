const metricsNode = document.getElementById("insight-metrics");
const refreshButton = document.getElementById("refresh-button");
const exportFunnelButton = document.getElementById("export-funnel-button");
const exportFailuresButton = document.getElementById("export-failures-button");
const filterForm = document.getElementById("insights-filter-form");
const resetFiltersButton = document.getElementById("reset-filters-button");
const funnelDaysInput = document.getElementById("filter-funnel-days");
const eventWindowDaysInput = document.getElementById("filter-event-window-days");
const failureTypeInput = document.getElementById("filter-failure-type");
const visitorsLimitInput = document.getElementById("filter-visitors-limit");
const failuresLimitInput = document.getElementById("filter-failures-limit");
const refundsLimitInput = document.getElementById("filter-refunds-limit");
const funnelChartTitle = document.getElementById("funnel-chart-title");
const eventChartTitle = document.getElementById("event-chart-title");
const funnelTableTitle = document.getElementById("funnel-table-title");
const visitorsTableTitle = document.getElementById("visitors-table-title");
const failuresTableTitle = document.getElementById("failures-table-title");
const refundsTableTitle = document.getElementById("refunds-table-title");
const dailyFunnelChart = document.getElementById("daily-funnel-chart");
const eventTypeChart = document.getElementById("event-type-chart");
const funnelTable = document.getElementById("funnel-table");
const visitorTable = document.getElementById("visitor-insights-table");
const failureTable = document.getElementById("failure-table");
const refundTable = document.getElementById("refund-insights-table");

let currentInsights = null;

const DEFAULT_FILTERS = {
  funnelDays: 14,
  eventWindowDays: 30,
  failureType: "all",
  visitorsLimit: 20,
  failuresLimit: 20,
  refundsLimit: 20
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function currentFilters() {
  return {
    funnelDays: Number(funnelDaysInput.value) || DEFAULT_FILTERS.funnelDays,
    eventWindowDays: Number(eventWindowDaysInput.value) || DEFAULT_FILTERS.eventWindowDays,
    failureType: failureTypeInput.value || DEFAULT_FILTERS.failureType,
    visitorsLimit: Number(visitorsLimitInput.value) || DEFAULT_FILTERS.visitorsLimit,
    failuresLimit: Number(failuresLimitInput.value) || DEFAULT_FILTERS.failuresLimit,
    refundsLimit: Number(refundsLimitInput.value) || DEFAULT_FILTERS.refundsLimit
  };
}

function setFilterInputs(filters) {
  funnelDaysInput.value = String(filters.funnelDays);
  eventWindowDaysInput.value = String(filters.eventWindowDays);
  failureTypeInput.value = filters.failureType;
  visitorsLimitInput.value = String(filters.visitorsLimit);
  failuresLimitInput.value = String(filters.failuresLimit);
  refundsLimitInput.value = String(filters.refundsLimit);
}

function failureTypeText(value) {
  if (value === "upload_failure") return "仅上传失败";
  if (value === "compress_failure") return "仅压缩失败";
  return "全部失败";
}

function renderMetrics(summary) {
  const items = [
    ["访客数", summary.visitors],
    ["事件数", summary.events],
    ["异常任务", summary.exceptionTasks],
    ["退款申请", summary.refundRequests],
    ["待处理退款", summary.pendingRefunds],
    ["压缩失败", summary.compressFailures],
    ["最近事件", summary.latestEventTime],
    ["最近访客", summary.latestVisitorTime]
  ];
  metricsNode.innerHTML = items
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
}

function renderTitles(summary) {
  funnelChartTitle.textContent = `近 ${summary.funnelDays} 天漏斗趋势`;
  funnelTableTitle.textContent = `近 ${summary.funnelDays} 天数据表`;
  eventChartTitle.textContent = `近 ${summary.eventWindowDays} 天事件类型`;
  visitorsTableTitle.textContent = `最近访客（前 ${summary.visitorsLimit} 条）`;
  failuresTableTitle.textContent = `最近失败记录（${failureTypeText(summary.failureType)}，前 ${summary.failuresLimit} 条）`;
  refundsTableTitle.textContent = `退款记录（前 ${summary.refundsLimit} 条）`;
}

function renderBarChart(container, rows, metrics, formatter = (value) => value) {
  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">暂无数据</div>';
    return;
  }
  const maxValue = Math.max(
    1,
    ...rows.flatMap((row) => metrics.map((item) => Number(row[item.key] || 0)))
  );
  container.innerHTML = rows
    .map((row) => `
      <div class="chart-row">
        <div class="chart-label">${escapeHtml(row.day || row.eventType || "--")}</div>
        <div class="chart-bars">
          ${metrics.map((item) => {
            const value = Number(row[item.key] || 0);
            const width = Math.max(4, Math.round((value / maxValue) * 100));
            return `
              <div class="chart-bar-group">
                <span class="chart-bar-label">${escapeHtml(item.label)}</span>
                <div class="chart-bar-track">
                  <div class="chart-bar-fill ${item.className}" style="width:${width}%"></div>
                </div>
                <span class="chart-bar-value">${escapeHtml(formatter(value, item.key, row))}</span>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `)
    .join("");
}

function renderFunnelTable(rows) {
  funnelTable.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.day)}</td>
      <td>${row.uvPageVisit}</td>
      <td>${row.pvPageVisit}</td>
      <td>${row.uploadSuccessCount}</td>
      <td>${row.compressStartCount}</td>
      <td>${row.compressSuccessCount}</td>
      <td>${row.compressFailureCount}</td>
      <td>${row.downloadSuccessCount}</td>
      <td>${row.paymentRequiredCount}</td>
      <td>${row.purchaseClickCount}</td>
      <td>${row.refundRequestCount}</td>
    </tr>
  `).join("");
}

function renderVisitors(rows) {
  visitorTable.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.visitor_id)}</td>
      <td>${escapeHtml(row.last_seen_at)}</td>
      <td>${row.page_visits}</td>
      <td>${row.upload_success}</td>
      <td>${row.compress_success}</td>
      <td>${row.compress_failure}</td>
      <td>${row.download_success}</td>
      <td>${row.quota_used}</td>
    </tr>
  `).join("");
}

function renderFailures(rows) {
  failureTable.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.event_time)}</td>
      <td>${escapeHtml(row.type)}</td>
      <td>${escapeHtml(row.visitor_id)}</td>
      <td>${escapeHtml(row.file_name || "--")}</td>
      <td>${escapeHtml(row.message || "--")}</td>
    </tr>
  `).join("");
}

function renderRefunds(rows) {
  refundTable.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.created_at)}</td>
      <td>${row.status === "refunded" ? "已退费" : "待处理"}</td>
      <td>${escapeHtml(row.contact_email || "--")}</td>
      <td>${escapeHtml(row.payment_account || "--")}</td>
      <td>${escapeHtml(row.package_name || "--")}</td>
      <td>${escapeHtml(row.amount_cny ?? "--")}</td>
      <td>${escapeHtml(row.admin_note || "--")}</td>
    </tr>
  `).join("");
}

function toCsv(rows) {
  return rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function downloadCsv(filename, rows) {
  const blob = new Blob(["\uFEFF", toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportFunnelCsv() {
  if (!currentInsights) return;
  const rows = [
    ["day", "uv_page_visit", "pv_page_visit", "upload_success_count", "compress_start_count", "compress_success_count", "compress_failure_count", "download_success_count", "payment_required_count", "purchase_click_count", "refund_request_count"],
    ...currentInsights.dailyFunnel.map((row) => [
      row.day,
      row.uvPageVisit,
      row.pvPageVisit,
      row.uploadSuccessCount,
      row.compressStartCount,
      row.compressSuccessCount,
      row.compressFailureCount,
      row.downloadSuccessCount,
      row.paymentRequiredCount,
      row.purchaseClickCount,
      row.refundRequestCount
    ])
  ];
  downloadCsv(`pdf-insights-funnel-${currentInsights.summary.funnelDays}d.csv`, rows);
}

function exportFailuresCsv() {
  if (!currentInsights) return;
  const rows = [
    ["event_time", "type", "visitor_id", "file_name", "message", "job_id"],
    ...currentInsights.recentFailures.map((row) => [
      row.event_time,
      row.type,
      row.visitor_id,
      row.file_name || "",
      row.message || "",
      row.job_id || ""
    ])
  ];
  downloadCsv(`pdf-insights-failures-${currentInsights.summary.failureType}.csv`, rows);
}

async function refreshInsights() {
  const filters = currentFilters();
  const params = new URLSearchParams({
    funnelDays: String(filters.funnelDays),
    eventWindowDays: String(filters.eventWindowDays),
    failureType: filters.failureType,
    visitorsLimit: String(filters.visitorsLimit),
    failuresLimit: String(filters.failuresLimit),
    refundsLimit: String(filters.refundsLimit)
  });

  refreshButton.disabled = true;
  refreshButton.textContent = "刷新中...";

  const response = await fetch(`/api/admin/insights?${params.toString()}`);
  if (!response.ok) {
    window.location.href = "/";
    return;
  }

  const data = await response.json();
  currentInsights = data;
  setFilterInputs(data.summary);
  renderMetrics(data.summary);
  renderTitles(data.summary);
  renderBarChart(dailyFunnelChart, data.dailyFunnel, [
    { key: "uvPageVisit", label: "UV", className: "is-brand" },
    { key: "uploadSuccessCount", label: "上传", className: "is-warning" },
    { key: "compressSuccessCount", label: "压缩成功", className: "is-success" },
    { key: "downloadSuccessCount", label: "下载", className: "is-muted" }
  ]);
  renderBarChart(eventTypeChart, data.eventTypes, [
    { key: "eventCount", label: "事件数", className: "is-brand" },
    { key: "uniqueVisitors", label: "访客数", className: "is-success" }
  ]);
  renderFunnelTable(data.dailyFunnel);
  renderVisitors(data.topVisitors);
  renderFailures(data.recentFailures);
  renderRefunds(data.refunds);

  refreshButton.disabled = false;
  refreshButton.textContent = "刷新数据";
}

filterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await refreshInsights();
});

resetFiltersButton.addEventListener("click", async () => {
  setFilterInputs(DEFAULT_FILTERS);
  await refreshInsights();
});

refreshButton.addEventListener("click", refreshInsights);
exportFunnelButton.addEventListener("click", exportFunnelCsv);
exportFailuresButton.addEventListener("click", exportFailuresCsv);

window.addEventListener("DOMContentLoaded", () => {
  setFilterInputs(DEFAULT_FILTERS);
  refreshInsights();
});
