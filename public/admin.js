const loginPanel = document.getElementById("login-panel");
const dashboardPanel = document.getElementById("dashboard-panel");
const loginForm = document.getElementById("login-form");
const settingsForm = document.getElementById("settings-form");
const exportButton = document.getElementById("export-button");
const logoutButton = document.getElementById("logout-button");
const addPackageButton = document.getElementById("add-package");
const addPaymentButton = document.getElementById("add-payment");
const packageEditor = document.getElementById("package-editor");
const paymentEditor = document.getElementById("payment-editor");
const summaryMetrics = document.getElementById("summary-metrics");
const visitorTable = document.getElementById("visitor-table");
const eventTable = document.getElementById("event-table");
const exceptionTable = document.getElementById("exception-table");
const refundTable = document.getElementById("refund-table");

let currentSettings = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function packageRow(pkg) {
  return `
    <div class="editor-card" data-package-id="${pkg.id}">
      <label class="toggle-line"><input class="pkg-enabled" type="checkbox" ${pkg.enabled ? "checked" : ""} /><span>启用</span></label>
      <label class="field"><span>套餐名称</span><div class="inline-field"><input class="pkg-name" type="text" value="${pkg.name}" /></div></label>
      <label class="field"><span>价格</span><div class="inline-field"><input class="pkg-price" type="number" min="0" step="0.01" value="${pkg.priceCny}" /></div></label>
      <label class="field"><span>说明</span><div class="inline-field"><input class="pkg-desc" type="text" value="${pkg.description || ""}" /></div></label>
      <label class="field"><span>权益类型</span><div class="inline-field"><select class="pkg-type"><option value="credit_pack" ${pkg.entitlementType === "credit_pack" ? "selected" : ""}>次数包</option><option value="duration_days" ${pkg.entitlementType === "duration_days" ? "selected" : ""}>会员时长</option></select></div></label>
      <label class="field"><span>权益值</span><div class="inline-field"><input class="pkg-value" type="number" min="1" step="1" value="${pkg.entitlementValue}" /></div></label>
      <label class="field"><span>购买链接</span><div class="inline-field"><input class="pkg-link" type="text" value="${pkg.buyLink || ""}" /></div></label>
    </div>
  `;
}

function paymentRow(item) {
  return `
    <div class="editor-card" data-payment-id="${item.id}">
      <label class="toggle-line"><input class="pay-enabled" type="checkbox" ${item.enabled ? "checked" : ""} /><span>启用</span></label>
      <label class="field"><span>收款方式名称</span><div class="inline-field"><input class="pay-name" type="text" value="${item.name}" /></div></label>
      <label class="field"><span>收款链接</span><div class="inline-field"><input class="pay-link" type="text" value="${item.link || ""}" /></div></label>
      <label class="field"><span>二维码地址</span><div class="inline-field"><input class="pay-qr" type="text" value="${item.qrCodeUrl || ""}" /></div></label>
      <label class="field"><span>收款说明</span><div class="textarea-field"><textarea class="pay-instructions" rows="3">${item.instructions || ""}</textarea></div></label>
      <label class="field"><span>支付后联系说明</span><div class="textarea-field"><textarea class="pay-post" rows="3">${item.postPaymentInstructions || ""}</textarea></div></label>
    </div>
  `;
}

function renderEditors(settings) {
  packageEditor.innerHTML = settings.packages.map(packageRow).join("");
  paymentEditor.innerHTML = settings.paymentMethods.map(paymentRow).join("");
}

function fillSettings(settings) {
  currentSettings = settings;
  document.getElementById("siteName").value = settings.siteName || "";
  document.getElementById("adminUsername").value = settings.adminUsername || "";
  document.getElementById("maxUploadMB").value = settings.maxUploadMB ?? 250;
  document.getElementById("cleanupMinutes").value = settings.cleanupMinutes ?? 60;
  document.getElementById("compressionTimeoutSeconds").value = settings.compressionTimeoutSeconds ?? 300;
  document.getElementById("freeUsageEnabled").checked = Boolean(settings.freeUsageEnabled);
  document.getElementById("freeUsageLimit").value = settings.freeUsageLimit ?? 3;
  document.getElementById("freeUsageResetMode").value = settings.freeUsageResetMode || "daily";
  document.getElementById("billingEnabled").checked = Boolean(settings.billingEnabled);
  document.getElementById("supportEmail").value = settings.supportEmail || "";
  document.getElementById("supportMessage").value = settings.supportMessage || "";
  document.getElementById("newPassword").value = "";
  renderEditors(settings);
}

function renderOverview(data) {
  summaryMetrics.innerHTML = [
    ["PV", data.summary.pv],
    ["UV", data.summary.uv],
    ["上传次数", data.summary.uploadCount],
    ["压缩次数", data.summary.compressCount],
    ["成功率", `${data.summary.successRate}%`],
    ["下载次数", data.summary.downloadCount],
    ["付费点击", data.summary.purchaseClickCount],
    ["免费次数触发", data.summary.paymentTriggerCount],
    ["退费申请", data.summary.refundRequestCount],
    ["已退费", data.summary.refundProcessedCount]
  ]
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");

  visitorTable.innerHTML = data.visitors.map((item) => `
    <tr>
      <td>${item.id}</td>
      <td>${item.lastSeenText}</td>
      <td>${item.pageVisits}</td>
      <td>${item.uploadSuccess}</td>
      <td>${item.compressStarts}</td>
      <td>${item.compressSuccess + item.compressPartialSuccess}</td>
      <td>${item.downloadSuccess}</td>
      <td>${item.purchaseClicks}</td>
    </tr>
  `).join("");

  eventTable.innerHTML = data.events.map((item) => `
    <tr>
      <td>${item.timeText}</td>
      <td>${item.visitorId}</td>
      <td>${item.type}</td>
      <td>${item.targetMB ?? "--"}</td>
      <td>${item.fileName || "--"}</td>
      <td>${item.message || "--"}</td>
    </tr>
  `).join("");

  exceptionTable.innerHTML = data.exceptionTasks.map((item) => `
    <tr>
      <td>${item.timeText}</td>
      <td>${item.kind}</td>
      <td>${item.jobId || "--"}</td>
      <td>${item.fileName || "--"}</td>
      <td>${item.message || "--"}</td>
    </tr>
  `).join("");

  refundTable.innerHTML = data.refundRequests.map((item) => `
    <tr>
      <td>${item.createdAtText}</td>
      <td>${item.status === "refunded" ? "已退费" : "待处理"}</td>
      <td>${item.contactEmail}</td>
      <td>${item.paymentAccount}${item.paymentName ? `<br /><span class="muted-text">${item.paymentName}</span>` : ""}</td>
      <td>${item.packageName || "--"}</td>
      <td>${item.amountCny ?? "--"}</td>
      <td>${item.reason}</td>
      <td>
        ${item.status === "refunded"
          ? `<span class="muted-text">已于 ${item.refundedAtText || "--"} 处理</span>`
          : `<button type="button" class="secondary-button refund-action" data-refund-id="${item.id}" data-account="${item.paymentAccount}">标记已退费</button>`}
      </td>
    </tr>
  `).join("");

  fillSettings(data.settings);
}

function collectPackages() {
  return Array.from(packageEditor.querySelectorAll(".editor-card")).map((node, index) => ({
    id: node.dataset.packageId || `pkg_${index + 1}`,
    enabled: node.querySelector(".pkg-enabled").checked,
    name: node.querySelector(".pkg-name").value.trim(),
    priceCny: Number(node.querySelector(".pkg-price").value),
    description: node.querySelector(".pkg-desc").value.trim(),
    entitlementType: node.querySelector(".pkg-type").value,
    entitlementValue: Number(node.querySelector(".pkg-value").value),
    buyLink: node.querySelector(".pkg-link").value.trim()
  }));
}

function collectPayments() {
  return Array.from(paymentEditor.querySelectorAll(".editor-card")).map((node, index) => ({
    id: node.dataset.paymentId || `payment_${index + 1}`,
    enabled: node.querySelector(".pay-enabled").checked,
    name: node.querySelector(".pay-name").value.trim(),
    link: node.querySelector(".pay-link").value.trim(),
    qrCodeUrl: node.querySelector(".pay-qr").value.trim(),
    instructions: node.querySelector(".pay-instructions").value.trim(),
    postPaymentInstructions: node.querySelector(".pay-post").value.trim()
  }));
}

async function refreshOverview() {
  const response = await fetch("/api/admin/overview");
  if (!response.ok) {
    loginPanel.hidden = false;
    dashboardPanel.hidden = true;
    return;
  }
  const data = await response.json();
  loginPanel.hidden = true;
  dashboardPanel.hidden = false;
  renderOverview(data);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: document.getElementById("username").value.trim(),
      password: document.getElementById("password").value
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    alert(payload.message || "账号或密码错误。");
    return;
  }
  await refreshOverview();
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    siteName: document.getElementById("siteName").value.trim(),
    adminUsername: document.getElementById("adminUsername").value.trim(),
    newPassword: document.getElementById("newPassword").value.trim(),
    maxUploadMB: Number(document.getElementById("maxUploadMB").value),
    cleanupMinutes: Number(document.getElementById("cleanupMinutes").value),
    compressionTimeoutSeconds: Number(document.getElementById("compressionTimeoutSeconds").value),
    freeUsageEnabled: document.getElementById("freeUsageEnabled").checked,
    freeUsageLimit: Number(document.getElementById("freeUsageLimit").value),
    freeUsageResetMode: document.getElementById("freeUsageResetMode").value,
    billingEnabled: document.getElementById("billingEnabled").checked,
    supportEmail: document.getElementById("supportEmail").value.trim(),
    supportMessage: document.getElementById("supportMessage").value.trim(),
    packages: collectPackages(),
    paymentMethods: collectPayments()
  };

  const response = await fetch("/api/admin/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    alert(data.message || "保存失败。");
    return;
  }
  await refreshOverview();
  alert("后台配置已保存。");
});

addPackageButton.addEventListener("click", () => {
  const pkg = {
    id: `pkg_${Date.now()}`,
    name: "新套餐",
    priceCny: 9.9,
    description: "",
    entitlementType: "credit_pack",
    entitlementValue: 1,
    buyLink: "",
    enabled: true
  };
  packageEditor.insertAdjacentHTML("beforeend", packageRow(pkg));
});

addPaymentButton.addEventListener("click", () => {
  const item = {
    id: `payment_${Date.now()}`,
    name: "新收款方式",
    link: "",
    qrCodeUrl: "",
    instructions: "",
    postPaymentInstructions: "",
    enabled: true
  };
  paymentEditor.insertAdjacentHTML("beforeend", paymentRow(item));
});

exportButton.addEventListener("click", () => {
  const link = document.createElement("a");
  link.href = "/api/admin/export";
  link.click();
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  loginPanel.hidden = false;
  dashboardPanel.hidden = true;
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest(".refund-action");
  if (!button) return;
  const refundId = button.getAttribute("data-refund-id");
  const defaultNote = `已人工退费至：${button.getAttribute("data-account") || ""}`;
  const adminNote = window.prompt("请输入退费备注，系统将记录该笔退费说明。", defaultNote);
  if (adminNote == null) return;
  const response = await fetch(`/api/admin/refunds/${refundId}/refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adminNote })
  });
  const data = await response.json();
  if (!response.ok) {
    alert(data.message || "退费处理失败。");
    return;
  }
  await refreshOverview();
});

window.addEventListener("DOMContentLoaded", refreshOverview);
