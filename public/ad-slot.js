// 可复用展示广告位：默认隐藏不占空间；仅当配置了广告且真广告成功填充时才显示。
// 复用到别的产品：拷本文件 + 一个 <div id="..." class="ad-slot" hidden> 容器 +
// /api/config 返回 adsEnabled/adClient/adSlot，然后在配置初始化后调 window.initAdSlot(id, cfg)。
(function () {
  "use strict";

  // 纯逻辑：是否应注入广告。未启用/未配置 → false（容器保持隐藏、不占空间）。
  function shouldInject(cfg) {
    return !!(cfg && cfg.adsEnabled && cfg.adClient && cfg.adSlot);
  }

  // 注入 AdSense 并尝试渲染；仅真广告 filled 才显示容器，否则保持隐藏不占空间（含被墙/无库存）。
  function initAdSlot(containerId, cfg) {
    if (typeof document === "undefined") return;
    var el = document.getElementById(containerId);
    if (!el) return;
    if (!shouldInject(cfg)) return; // 未启用/未配置 → 不注入、容器保持 hidden

    var ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.display = "block";
    ins.setAttribute("data-ad-client", cfg.adClient);
    ins.setAttribute("data-ad-slot", cfg.adSlot);
    ins.setAttribute("data-ad-format", "auto");
    ins.setAttribute("data-full-width-responsive", "true");
    el.appendChild(ins);

    var loader = document.createElement("script");
    loader.async = true;
    loader.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(cfg.adClient);
    loader.crossOrigin = "anonymous";
    loader.onload = function () { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {} };
    loader.onerror = function () { /* 脚本被墙/失败 → 容器保持隐藏 */ };
    document.head.appendChild(loader);

    // 轮询填充状态：filled → 显示；unfilled 或 ~3.5s 超时 → 保持隐藏不占空间。
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var status = ins.getAttribute("data-ad-status");
      if (status === "filled") { el.hidden = false; clearInterval(timer); }
      else if (status === "unfilled" || tries >= 7) { clearInterval(timer); }
    }, 500);
  }

  if (typeof window !== "undefined") { window.initAdSlot = initAdSlot; window.adSlotShouldInject = shouldInject; }
  if (typeof module !== "undefined" && module.exports) { module.exports = { shouldInject, initAdSlot }; }
})();
