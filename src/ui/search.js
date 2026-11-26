'use strict';
// The stash searches menu on top of the game: one line per saved search. A click puts that
// search in the game's stash search box (main.js does the typing, after closing the menu).
(() => {
  const api = window.api;
  const menu = document.getElementById('menu');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let drawn = '';
  let sentHeight = -1;
  let pickedAt = 0;

  function render(d) {
    const entries = (d && d.entries) || [];
    const key = JSON.stringify(d || null);
    if (key !== drawn) {
      drawn = key;
      menu.innerHTML = `<div class="ss-head"><b>Stash searches</b><span>Esc closes</span></div>`
        + (entries.length
          ? `<div class="ss-list">${entries.map((s) => `<button type="button" class="ss-pick" data-i="${s.i}" title="${esc(s.long ? `${s.text}\n\nLonger than the game's 250 characters: the end is cut off in game.` : s.text)}">
              <span class="ss-name">${esc(s.name)}</span>${s.name !== s.text ? `<span class="ss-text${s.long ? ' ss-long' : ''}">${esc(s.text)}</span>` : ''}</button>`).join('')}</div>`
          : '<p class="ss-empty">No searches saved yet. Add them in Map Companion, on the <b>Regex</b> page.</p>');
    }
    // Measured without the limit to the window's height: the window starts 10 pixels tall, and
    // measured inside it the menu would ask for those 10 pixels and stay a thin line.
    menu.style.maxHeight = 'none';
    const h = Math.ceil(menu.getBoundingClientRect().height);
    menu.style.maxHeight = '';
    if (h !== sentHeight) { sentHeight = h; api.searchSize(h); }
  }

  // Both the page's own press and the press the app saw may come for one click: one pick only.
  function pick(el) {
    const b = el && el.closest && el.closest('[data-i]');
    if (!b) return;
    const now = performance.now();
    if (now - pickedAt < 400) return;
    pickedAt = now;
    b.classList.add('hit');
    api.action({ type: 'stashSearch', i: Number(b.dataset.i) });
  }
  menu.addEventListener('pointerdown', (e) => { if (e.button === 0) pick(e.target); });
  if (api.onSearchPress) api.onSearchPress((p) => pick(document.elementFromPoint(p.x, p.y)));
  api.onSearches(render);
})();
