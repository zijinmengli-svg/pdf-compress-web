(function () {
  "use strict";
  const badge = document.getElementById("credit-balance");
  const buy = document.getElementById("credit-buy");
  if (!badge || !buy) return;
  let enabled = false;
  let timer;
  let version = 0;
  async function refresh() {
    if (!enabled) return;
    const request = ++version;
    clearTimeout(timer);
    try {
      const response = await fetch("/api/credits/balance", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      const balance = await response.json();
      if (request !== version) return;
      if (!Number.isSafeInteger(balance.available) || balance.available < 0) throw new Error("Invalid balance");
      const n = balance.available;
      const zh = document.documentElement.lang.startsWith("zh");
      badge.textContent = zh ? `剩余 ${n} 次压缩` : `${n} compression${n === 1 ? "" : "s"} left`;
      badge.hidden = false;
      badge.title = zh ? "每天北京时间 02:00 刷新免费次数" : "Free credit resets daily at 02:00 Beijing time";
      const untilReset = Date.parse(balance.resetsAt) - Date.now();
      if (Number.isFinite(untilReset)) timer = setTimeout(refresh, Math.max(2000, Math.min(untilReset + 1000, 86_400_000)));
    } catch {
      if (request !== version) return;
      badge.hidden = true;
      timer = setTimeout(refresh, 30_000);
    }
  }
  window.TinyPDFCreditBalance = { configure(payment) {
    enabled = payment?.quotaEnabled === true;
    buy.hidden = payment?.enabled !== true;
    if (enabled) refresh();
    else { ++version; clearTimeout(timer); badge.hidden = true; }
  }, refresh };
  window.addEventListener("tinypdf:auth-changed", refresh);
  window.addEventListener("pageshow", refresh);
  window.addEventListener("focus", refresh);
})();
