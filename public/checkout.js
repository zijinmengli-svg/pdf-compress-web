(function () {
  "use strict";

  const buy = document.getElementById("checkout-buy");
  if (!buy) return;
  const byId = id => document.getElementById(id);
  const zh = document.documentElement.lang.startsWith("zh");
  const copy = (cn, en) => zh ? cn : en;
  const message = byId("checkout-message");
  const language = byId("checkout-language");
  const orderPanel = byId("checkout-order");
  const refresh = byId("checkout-refresh");
  const feedback = byId("checkout-check-feedback");
  const packs = byId("checkout-packs");
  const orderPattern = /^ord_[a-z0-9_-]{1,100}$/i;
  let orderId = new URL(location.href).searchParams.get("order") || "";
  if (!orderPattern.test(orderId)) orderId = "";
  let authenticated = false;
  let config = null;
  let opening = false;
  let overlay = false;
  let waiting = false;
  let initialized = false;
  let revision = 0;
  let remainingChecks = 0;
  let pollTimer;
  let checking = false;

  const say = value => { message.textContent = value; };
  const quantity = () => Number(packs.querySelector("input:checked").value);
  function render() {
    const n = quantity();
    const rates = config?.payment?.referenceUnitMinor;
    const total = (currency, fallback) => ((Number.isSafeInteger(rates?.[currency]) && rates[currency] > 0
      ? rates[currency] : fallback) * n / 100).toFixed(2);
    byId("checkout-price").textContent = copy(
      `中国大陆 ¥${total("CNY", 990)} · 美元基础价 $${total("USD", 199)}`,
      `Mainland China ¥${total("CNY", 990)} · USD base $${total("USD", 199)}`
    );
    buy.textContent = copy(`购买 ${n} 次`, `Buy ${n} compression${n === 1 ? "" : "s"}`);
    buy.disabled = !config?.payment?.enabled || opening || overlay || waiting;
    packs.disabled = opening || overlay || waiting;
    orderPanel.hidden = !authenticated || !orderId;
    byId("checkout-order-id").textContent = authenticated ? orderId : "";
    refresh.disabled = checking;
    refresh.textContent = checking ? copy("查询中…", "Checking…") : copy("查询订单状态", "Check order status");
    orderPanel.setAttribute("aria-busy", String(checking));
    language.href = (zh ? "/buy" : "/zh/buy") + (orderId ? `?order=${encodeURIComponent(orderId)}` : "");
  }
  async function request(url, options) {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options });
    if (!response.ok) throw Object.assign(new Error("Request failed"), { status: response.status });
    return response.json();
  }
  function scheduleCheck() {
    clearTimeout(pollTimer);
    if (remainingChecks-- > 0) pollTimer = setTimeout(check, 2500);
    else {
      say(copy("到账确认尚未完成。已支付请勿重复购买，可用订单编号查询。", "Payment is still being verified. If you paid, do not buy again; check this order."));
      render();
    }
  }
  async function check(manual = false) {
    if (!authenticated || !orderId) return;
    if (checking && !manual) return;
    const id = orderId;
    const requestRevision = ++revision;
    clearTimeout(pollTimer);
    checking = true;
    if (manual) feedback.textContent = copy("正在查询订单…", "Checking order…");
    render();
    try {
      const order = await request(`/api/credits/purchase-status?orderId=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(10_000) });
      if (requestRevision !== revision || orderId !== id || !authenticated) return;
      byId("checkout-transaction").textContent = order.transactionId || "—";
      const states = {
        completed: copy("支付已确认，次数已到账。", "Payment confirmed"),
        refunded: copy("订单已退款。", "Order refunded"),
        refund_pending: copy("退款处理中。", "Refund pending"),
        refund_review: copy("退款待复核。", "Refund under review"),
        pending: copy("正在等待支付确认", "Waiting for payment confirmation"),
      };
      say(states[order.status] || copy("订单状态暂不可用。", "Order status unavailable."));
      if (manual) feedback.textContent = order.status === "pending"
        ? copy("已查询：尚未确认付款。", "Checked: payment is still pending.")
        : copy("已更新订单状态。", "Order status refreshed.");
      if (order.status === "pending" && waiting) scheduleCheck();
      else waiting = false;
    } catch (error) {
      if (requestRevision !== revision) return;
      say(copy("暂时无法查询该订单。请确认已登录购买时使用的邮箱。", "Cannot check this order. Sign in with the email used to buy it."));
      if (manual) feedback.textContent = copy("查询失败，请稍后重试。", "Status check failed. Try again.");
      if (waiting && error.status !== 401 && error.status !== 404) scheduleCheck();
      else waiting = false;
    } finally {
      if (requestRevision === revision) { checking = false; render(); }
    }
  }
  async function paddle() {
    if (!window.Paddle) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
        script.onload = resolve;
        script.onerror = () => { script.remove(); reject(new Error("Checkout unavailable")); };
        document.head.appendChild(script);
      });
    }
    const sdk = window.Paddle;
    if (!initialized) {
      const { environment, clientToken } = config.payment.checkout;
      if (environment === "sandbox") sdk.Environment.set("sandbox");
      sdk.Initialize({ token: clientToken, eventCallback: event => {
        if (!authenticated || !orderId || (!overlay && !waiting)) return;
        if (event.name === "checkout.completed") {
          overlay = false;
          waiting = true;
          remainingChecks = 24;
          say(copy("正在等待支付确认", "Waiting for payment confirmation"));
          render();
          check();
        } else if (event.name === "checkout.closed" && !waiting) {
          overlay = false;
          say(copy("已关闭支付窗口。可查询订单状态。", "Checkout closed. You can check your order status."));
          render();
        } else if (event.name === "checkout.error" && !waiting) {
          overlay = false;
          say(copy("无法打开结账，请重试。", "Could not open checkout. Try again."));
          render();
        } else if (["checkout.payment.error", "checkout.payment.failed"].includes(event.name) && overlay) {
          say(copy("支付未成功，请在结账页重试。", "Payment failed. Please retry in checkout."));
        }
      } });
      initialized = true;
    }
    return sdk;
  }
  packs.addEventListener("change", render);
  refresh.addEventListener("click", () => check(true));
  window.addEventListener("tinypdf:auth-changed", event => {
    authenticated = Boolean(event.detail?.authenticated);
    if (authenticated && orderId) check();
    else if (!authenticated) {
      ++revision;
      checking = false;
      clearTimeout(pollTimer);
      feedback.textContent = "";
      const wasOpen = overlay;
      overlay = waiting = false;
      if (wasOpen) window.Paddle?.Checkout.close?.();
      byId("checkout-transaction").textContent = "";
      if (orderId) say(copy("登录购买时使用的邮箱以查询订单。", "Sign in with the email used to buy this order."));
    }
    render();
  });
  buy.addEventListener("click", async () => {
    if (buy.disabled) return;
    if (!authenticated) { byId("email-login-button").click(); return; }
    opening = true;
    const startingRevision = revision;
    const selected = quantity();
    render();
    try {
      config = await request("/api/config");
      if (!config.payment?.enabled || !config.payment.checkout) throw new Error("Checkout disabled");
      const sdk = await paddle();
      if (!authenticated || startingRevision !== revision) return;
      const order = await request("/api/credits/purchase-intent", {
        method: "POST", headers: { "Content-Type": "application/json", "X-TinyPDF-Web-Token": config.webRequestToken || "" },
        body: JSON.stringify({ quantity: selected }),
      });
      if (!authenticated || startingRevision !== revision) return;
      if (!orderPattern.test(order.orderId) || order.quantity !== selected || !order.priceId || !order.customData?.paymentOrderIntent) {
        throw new Error("Invalid order");
      }
      orderId = order.orderId;
      feedback.textContent = "";
      history.replaceState(null, "", `?order=${encodeURIComponent(orderId)}`);
      byId("checkout-transaction").textContent = "—";
      say(copy("订单已创建，请完成支付。", "Order created. Complete payment in checkout."));
      overlay = true;
      sdk.Checkout.open({
        items: [{ priceId: order.priceId, quantity: order.quantity }],
        customData: order.customData,
        settings: { displayMode: "overlay", variant: "one-page", theme: "dark", locale: zh ? "zh-Hans" : "en" },
      });
    } catch (error) {
      overlay = false;
      if (error.status === 401) byId("email-login-button").click();
      say(copy("暂时无法开始支付，请重试。", "Could not start checkout. Try again."));
    } finally { opening = false; render(); }
  });
  request("/api/config").then(data => {
    config = data;
    if (!data.payment?.enabled && !orderId) say(copy("暂未开放购买。", "Purchases are not available yet."));
  }).catch(() => say(copy("暂时无法加载购买页面。", "Could not load purchase options."))).finally(render);
  render();
})();
