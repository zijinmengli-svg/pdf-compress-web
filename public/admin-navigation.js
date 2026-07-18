(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TinyPdfAdminNavigation = api;
  if (root && root.document) api.setupAdminNavigation(root.document, root);
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const ACTIVE_CLASS = "is-active";
  const SECTION_OFFSET = 120;

  function setupAdminNavigation(documentRef, windowRef) {
    const links = Array.from(documentRef.querySelectorAll(".admin-nav a"));
    const items = links.map(link => {
      const hash = link.getAttribute("href") || "";
      return { link, hash, section: hash.startsWith("#") ? documentRef.getElementById(hash.slice(1)) : null };
    }).filter(item => item.section);

    if (!items.length) return;

    function activate(hash) {
      items.forEach(item => {
        const method = item.hash === hash ? "add" : "remove";
        item.link.classList[method](ACTIVE_CLASS);
      });
    }

    function activeHashFromScroll() {
      let active = items[0].hash;
      items.forEach(item => {
        if (item.section.getBoundingClientRect().top <= SECTION_OFFSET) active = item.hash;
      });
      return active;
    }

    items.forEach(item => item.link.addEventListener("click", () => activate(item.hash)));
    windowRef.addEventListener("hashchange", () => activate(windowRef.location.hash || activeHashFromScroll()));
    windowRef.addEventListener("scroll", () => activate(activeHashFromScroll()), { passive: true });

    const initialHash = items.some(item => item.hash === windowRef.location.hash)
      ? windowRef.location.hash
      : activeHashFromScroll();
    activate(initialHash);
  }

  return { setupAdminNavigation };
});
