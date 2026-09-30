/* Presentation only: keep the existing file input and compression connection alive. */
(() => {
  const card = document.getElementById('status-card');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('compression-outline');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('pathLength', '100');
  svg.append(path);
  card.prepend(svg);
  function drawOutline() {
    const style = getComputedStyle(card);
    const border = parseFloat(style.borderTopWidth) || 0;
    const w = card.offsetWidth, h = card.offsetHeight, p = border / 2;
    if (!w || !h) return;
    const r = Math.max(0, parseFloat(style.borderRadius) - p);
    // The absolute containing block starts inside the border. Offset back to
    // the outer box so the stroke straddles the border's center, not its inside.
    svg.style.left = `${-border}px`;
    svg.style.top = `${-border}px`;
    svg.style.width = `${w}px`;
    svg.style.height = `${h}px`;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    // Begin at the upper-left tangent; travel clockwise around the real perimeter.
    path.setAttribute('d', `M ${p+r} ${p} H ${w-p-r} A ${r} ${r} 0 0 1 ${w-p} ${p+r} V ${h-p-r} A ${r} ${r} 0 0 1 ${w-p-r} ${h-p} H ${p+r} A ${r} ${r} 0 0 1 ${p} ${h-p-r} V ${p+r} A ${r} ${r} 0 0 1 ${p+r} ${p}`);
    path.style.strokeDasharray = `${100 * Number(card.dataset.progress || 0)} 100`;
  }
  new ResizeObserver(drawOutline).observe(card);
  card.addEventListener('compression-progress', drawOutline);

  let switching = false;
  document.querySelector('.language-menu').addEventListener('click', async event => {
    const link = event.target.closest('a');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (switching) return;
    switching = true;
    const menu = document.querySelector('.language-menu');
    menu.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(link.href);
      if (!response.ok) throw new Error('language');
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (!page.querySelector('#compress-form')) throw new Error('language');
      const selectors = ['.hero-sub', '.lead', '.quota-preview', '.field > span', '#retry-button'];
      for (const selector of selectors) {
        document.querySelector(selector).textContent = page.querySelector(selector).textContent;
      }

      for (const selector of ['.processing-note', '.footer-inner', '.language-menu']) {
        const current = document.querySelector(selector), source = page.querySelector(selector);
        current.replaceChildren(...Array.from(source.childNodes, node => document.importNode(node, true)));
      }
      document.documentElement.lang = page.documentElement.lang;
      document.title = page.title;
      const url = new URL(link.href);
      history.replaceState(null, '', url.pathname + location.search + location.hash);
      document.dispatchEvent(new Event('tinypdf-language'));
      menu.open = false;
    } catch {
      // Never navigate away and discard the user's file on a language fetch failure.
      menu.title = document.documentElement.lang.startsWith('zh') ? '切换失败，请稍后重试。文件已保留。' : 'Could not switch language. Please retry; your file is preserved.';
    } finally {
      switching = false;
      menu.removeAttribute('aria-busy');
    }
  });
})();
