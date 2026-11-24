'use strict';
// Layout mode: drag each overlay part to where it should sit in game. Save keeps it, Esc cancels.
(async () => {
  const api = window.api;
  const stage = document.getElementById('stage');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // What each part looks like while it is being placed.
  const SAMPLES = {
    toast: '<div class="toast-box"><b>Chaos Orb ×40: 40c (1c each)</b><span>Shown for a moment after the check key.</span></div>',
    check: `<div class="pc-panel"><div class="pc-head"><span class="pc-art big h1"></span><div class="pc-meta"><h1>Doom Loop, Two-Stone Ring</h1><p class="pc-about">Two-Stone Ring · item level 84</p>
        <div class="pc-price"><b>45–120</b><span class="pc-cw">chaos</span><small>cheapest – typical</small></div><p class="pc-sub"><b>37</b> listed</p></div></div>
      <div class="pc-body"><div class="pc-chips"><span class="pc-chip on">Ring</span><span class="pc-chip on">Not corrupted</span></div>
        <ul class="pc-rows">${[['+91 total maximum Life', 82], ['+69% total Elemental Resistance', 62], ['+17% to Chaos Resistance', 15]]
    .map(([label, n]) => `<li class="on"><span class="pc-tick"><input type="checkbox" checked tabindex="-1"><span class="m-pseudo">${label}</span></span><div class="pc-num"><button tabindex="-1">−</button><b>${n}</b><button tabindex="-1">+</button></div></li>`).join('')}</ul></div>
      <div class="pc-go"><button type="button" class="primary" tabindex="-1">Search</button></div></div>`,
    trade: [['Invite', 'Tabula Rasa Simple Robe', '12 chaos'], ['Trade', '400× Chaos Orb', '1.5 divine'], ['Hideout', 'The Nurse', '75 chaos']]
      .map(([step, item, price]) => `<div class="tt in"><button type="button" class="primary" tabindex="-1">${step}</button><span class="tt-open"><span class="tt-item">${item}</span><span class="tt-price">${price}</span></span></div>`).join(''),
  };
  const data = await api.layout();
  const boxes = new Map(); // id -> { el, x, y, width, height, reset }
  // The strip with the buttons: small, out of the middle, and it can be dragged anywhere.
  // Where it was left is remembered for next time.
  const bar = document.getElementById('bar');
  bar.title = `Drag each box to where you want it in game. This strip can be dragged too. Save keeps the spots${data.hotkey ? `; ${data.hotkey} or Esc closes without saving` : '; Esc closes without saving'}.`;
  const barPos = { x: 0, y: 0 };
  function placeBar() {
    barPos.x = Math.max(0, Math.min(barPos.x, window.innerWidth - bar.offsetWidth));
    barPos.y = Math.max(0, Math.min(barPos.y, window.innerHeight - bar.offsetHeight));
    bar.style.left = `${barPos.x}px`; bar.style.top = `${barPos.y}px`;
  }
  {
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem('layoutBar')); } catch (_) { /* nothing remembered */ }
    if (kept && isFinite(kept.x) && isFinite(kept.y)) { barPos.x = kept.x; barPos.y = kept.y; }
    else { barPos.x = (window.innerWidth - bar.offsetWidth) / 2; barPos.y = 16; } // top centre
    placeBar();
    let grab = null;
    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      grab = { dx: e.clientX - barPos.x, dy: e.clientY - barPos.y };
      try { bar.setPointerCapture(e.pointerId); } catch (_) { /* not a real pointer */ }
      bar.classList.add('drag');
    });
    bar.addEventListener('pointermove', (e) => {
      if (!grab) return;
      barPos.x = e.clientX - grab.dx; barPos.y = e.clientY - grab.dy;
      placeBar();
    });
    const drop = () => {
      if (!grab) return;
      grab = null; bar.classList.remove('drag');
      try { localStorage.setItem('layoutBar', JSON.stringify(barPos)); } catch (_) { /* not remembered, no harm */ }
    };
    bar.addEventListener('pointerup', drop);
    bar.addEventListener('pointercancel', drop);
  }

  function place(b) {
    b.x = Math.max(0, Math.min(b.x, window.innerWidth - b.width));
    b.y = Math.max(0, Math.min(b.y, window.innerHeight - b.height));
    b.el.style.left = `${b.x}px`; b.el.style.top = `${b.y}px`;
    b.el.classList.toggle('low', b.y < 30); // no room above for the name tag
  }

  for (const w of data.widgets) {
    const el = document.createElement('div');
    el.className = 'lw';
    el.innerHTML = `<span class="lw-name">${esc(w.label)}</span><div class="lw-sample">${SAMPLES[w.id] || ''}</div>`;
    el.style.width = `${w.width}px`; el.style.height = `${w.height}px`;
    stage.appendChild(el);
    const b = { el, x: w.x, y: w.y, width: w.width, height: w.height, reset: false };
    boxes.set(w.id, b);
    place(b);
    let grab = null;
    el.addEventListener('pointerdown', (e) => {
      grab = { dx: e.clientX - b.x, dy: e.clientY - b.y };
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* not a real pointer */ }
      el.classList.add('drag');
    });
    el.addEventListener('pointermove', (e) => {
      if (!grab) return;
      b.x = e.clientX - grab.dx; b.y = e.clientY - grab.dy; b.reset = false;
      place(b);
    });
    const drop = () => { grab = null; el.classList.remove('drag'); };
    el.addEventListener('pointerup', drop);
    el.addEventListener('pointercancel', drop);
  }

  const save = () => api.action({
    type: 'layoutSave', screen: { width: window.innerWidth, height: window.innerHeight },
    widgets: [...boxes].map(([id, b]) => ({ id, x: b.x, y: b.y, width: b.width, height: b.height, reset: b.reset })),
  });
  document.getElementById('lw-done').addEventListener('click', save);
  document.getElementById('lw-cancel').addEventListener('click', () => api.action({ type: 'layoutCancel' }));
  document.getElementById('lw-reset').addEventListener('click', async () => {
    await api.action({ type: 'layoutReset' });
    const fresh = await api.layout();
    for (const w of fresh.widgets) { const b = boxes.get(w.id); if (b) { b.x = w.x; b.y = w.y; b.reset = true; place(b); } }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.action({ type: 'layoutCancel' });
    else if (e.key === 'Enter') save();
  });
})();
