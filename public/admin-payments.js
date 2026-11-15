(function () {
  "use strict";
  const get = id => document.getElementById(id);
  const search = get("payment-search");
  const message = get("payment-message");
  const table = document.querySelector(".payment-table");
  const dialog = get("payment-detail");
  const refundForm = get("payment-refund-form");
  const detailMessage = get("payment-detail-message");
  const orders = get("payment-orders");
  const close = get("payment-detail-close");
  const states = { pending: "未支付", completed: "已支付", refund_pending: "退款处理中", refund_review: "待复核", refunded: "已退款" };
  let searchVersion = 0;
  let refundsEnabled = false;
  let selected = null;
  let refundBusy = false;
  const date = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" });

  function amount(order) {
    if (!Number.isSafeInteger(order.amountMinor) || !/^[A-Z]{3}$/.test(order.currency || "")) return "—";
    try {
      const fmt = new Intl.NumberFormat("zh-CN", { style: "currency", currency: order.currency, currencyDisplay: "code" });
      return fmt.format(order.amountMinor / 10 ** fmt.resolvedOptions().maximumFractionDigits);
    } catch { return "—"; }
  }
  function dateLabel(order) {
    const time = new Date(order.createdAt);
    return order.createdAt && Number.isFinite(time.getTime()) ? date.format(time) : "—";
  }
  function detail(order, refund) {
    selected = order;
    const fields = [
      ["订单号", order.orderId], ["交易编号", order.transactionId], ["邮箱", order.email],
      ["时间", dateLabel(order)], ["购买次数", order.quantity], ["实付", amount(order)],
      ["状态", states[order.status]], ["退款编号", order.adjustmentId],
    ];
    const nodes = fields.flatMap(([label, value]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value ?? "—";
      return [dt, dd];
    });
    get("payment-detail-fields").replaceChildren(...nodes);
    detailMessage.textContent = "";
    refundForm.reset();
    refundForm.hidden = !(refund && refundsEnabled && order.status === "completed");
    dialog.showModal();
  }
  function render(results) {
    orders.replaceChildren();
    for (const order of results) {
      const row = document.createElement("tr");
      for (const value of [dateLabel(order), order.email, order.orderId, order.quantity, amount(order), states[order.status]]) {
        row.insertCell().textContent = value ?? "—";
      }
      const actions = row.insertCell();
      const button = document.createElement("button");
      button.textContent = "查看详情";
      button.addEventListener("click", () => detail(order, false));
      actions.append(button);
      if (refundsEnabled && order.status === "completed") {
        const refund = document.createElement("button");
        refund.textContent = "申请退款";
        refund.addEventListener("click", () => detail(order, true));
        actions.append(" ", refund);
      }
      orders.append(row);
    }
  }
  async function load() {
    const version = ++searchVersion;
    message.textContent = "正在查询…";
    get("payment-login").hidden = true;
    table.hidden = true;
    orders.replaceChildren();
    try {
      const query = new URLSearchParams(new FormData(search));
      const res = await fetch(`/api/admin/payments?${query}`, { cache: "no-store", credentials: "same-origin" });
      if (version !== searchVersion) return;
      if (res.status === 401) {
        get("payment-login").hidden = false;
        message.textContent = "请先登录管理员后台。";
        return;
      }
      if (res.status === 400) { message.textContent = "请检查日期范围或查询条件。"; return; }
      if (!res.ok) throw new Error("unavailable");
      const data = await res.json();
      if (version !== searchVersion) return;
      refundsEnabled = data.refundsEnabled === true;
      render(data.orders);
      table.hidden = false;
      message.textContent = data.orders.length ? (refundsEnabled ? "" : "当前仅可查询，退款未启用。") : "未找到匹配订单。";
    } catch {
      if (version === searchVersion) message.textContent = "暂时无法查询订单，请稍后重试。";
    }
  }
  search.addEventListener("submit", event => { event.preventDefault(); load(); });
  close.addEventListener("click", () => { if (!refundBusy) dialog.close(); });
  dialog.addEventListener("cancel", event => { if (refundBusy) event.preventDefault(); });
  refundForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (refundBusy || !selected || !refundsEnabled) return;
    const data = new FormData(refundForm);
    if (!data.get("reason") || !data.has("confirm")) return;
    refundBusy = close.disabled = true;
    refundForm.hidden = true;
    detailMessage.textContent = "正在提交退款申请…";
    try {
      const res = await fetch("/api/admin/payments/refund", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: selected.orderId, reason: data.get("reason"), confirm: true }),
      });
      detailMessage.textContent = res.status === 202
        ? "退款申请已提交，最终状态以支付平台确认为准。"
        : "退款尚未确认。请先刷新订单状态，不要重复提交。";
    } catch { detailMessage.textContent = "退款状态未知。请先刷新订单状态，不要重复提交。"; }
    finally { refundBusy = close.disabled = false; await load(); }
  });
  load();
})();
