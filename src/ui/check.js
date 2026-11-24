'use strict';
// The price check window on top of the game: the item's picture with its sockets and the
// answer beside it, the item's stats with tick boxes and a number to nudge with - and +, and
// what the trade site lists like it, each listing with its own picture. The window never takes
// the keyboard (the game keeps it), so nothing here is typed: exact numbers and a highest value
// can be set on the app's Prices page, which shows the same search.
(() => {
  const api = window.api;
  const panel = document.getElementById('panel');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KIND_WORDS = { pseudo: 'total', implicit: 'implicit', corruption: 'corruption', crafted: 'crafted', fractured: 'fractured', enchant: 'enchant', scourge: 'scourge', crucible: 'crucible' };
  const COIN_WORDS = { chaos: 'chaos', divine: 'divine', exalted: 'exalted', mirror: 'mirror' };
  const STATUS_WORDS = { instant: 'Instant buyout', online: 'Online', afk: 'Away', offline: 'Offline' };

  let data = null;
  let rows = [];     // what is ticked and set right now
  let formFor = '';  // which item and which round of choices the rows belong to
  let mode = 'stats'; // which of the two searches is set up: by the item's stats, or for its base
  let modeFor = 0;    // the item the mode belongs to

  function fmtValue(c) {
    const divine = data ? data.divine : 0;
    if (!isFinite(c)) return '0c';
    const a = Math.abs(c);
    if (divine > 0 && a >= divine) return `${(c / divine).toFixed(a >= divine * 10 ? 1 : 2)} div`;
    return `${a >= 100 ? Math.round(c) : Math.round(c * 10) / 10}c`;
  }
  function ago(ts, withAgo) {
    if (!ts) return '';
    const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (withAgo) return secs < 60 ? 'just now' : `${ago(ts)} ago`;
    const m = Math.floor(secs / 60);
    if (m < 60) return `${m} min`;
    if (m < 48 * 60) return `${Math.floor(m / 60)} h`;
    return `${Math.floor(m / 1440)} d`;
  }
  // About a twentieth of the item's own value per click, and never less than one.
  function stepFor(value) {
    if (!Number.isInteger(Number(value))) return 0.1;
    return Math.max(1, Math.round(Math.abs(Number(value) || 0) * 0.05));
  }

  function rowsFrom(f) {
    const out = [];
    // Short facts about the item: shown as a row of buttons, lit when they are part of the search.
    // pk: the tick's name in the two ready-made searches (see presets).
    if (f.category) out.push({ tc: 'category', pk: 'category', chip: true, label: f.category.label, title: 'Any base type of this kind', enabled: f.category.enabled });
    if (f.type) out.push({ tc: 'type', pk: 'type', chip: true, label: f.type.value, title: 'Only this base type', enabled: f.type.enabled });
    for (const x of f.flags) out.push({ tc: 'flag', pk: `flag:${x.key}`, chip: true, key: x.key, label: x.label, enabled: x.enabled });
    out.push({ tc: 'offline', chip: true, label: 'Offline sellers too', enabled: f.offline });
    for (const x of f.props) out.push({ tc: 'prop', pk: `prop:${x.key}`, key: x.key, label: `${x.label}: ${x.value}`, enabled: x.enabled, bound: 'min', num: x.min === null ? x.value : x.min, step: stepFor(x.value) });
    for (const x of f.stats) {
      // The number shown is the one the search asks for: a lowest value for most stats, a
      // highest where less is better. A "reduced" stat is kept below zero by the trade site;
      // it is shown the way the item words it.
      const bound = x.value === null ? null : (x.min === null && x.max !== null ? 'max' : 'min');
      out.push({ tc: 'stat', pk: `stat:${x.key}`, key: x.key, label: x.text, mk: x.kind || 'explicit', kind: KIND_WORDS[x.kind] || '', tiers: x.tiers || [], enabled: x.enabled, bound, num: bound ? x[bound] : null, step: stepFor(x.value), flip: !!x.negated });
    }
    return out;
  }

  const chipHtml = (r, i) => `<button type="button" class="pc-chip${r.enabled ? ' on' : ''}" data-row="${i}" aria-pressed="${r.enabled}"${r.title ? ` title="${esc(r.title)}"` : ''}>${esc(r.label)}</button>`;
  // One stat: a tick, the line in the colour the game gives its kind, its tier, and the number
  // searched for between - and +.
  function rowHtml(r, i) {
    let num = '';
    if (r.bound && r.num !== null) {
      const word = (r.bound === 'min') !== r.flip ? 'at least' : 'at most';
      num = `<div class="pc-num" title="${word}"><button type="button" data-step="-1" aria-label="Lower">−</button><b>${esc(r.flip ? -r.num : r.num)}</b><button type="button" data-step="1" aria-label="Higher">+</button></div>`;
    }
    const tiers = (r.tiers || []).map((t) => `<small class="pc-tier${t === 1 ? ' best' : ''}" title="Tier ${t}: tier 1 is the best this modifier can be">T${t}</small>`).join('');
    const kind = r.kind && r.mk !== 'pseudo' ? `<small class="k-${r.mk}">${r.kind}</small>` : '';
    return `<li class="${r.enabled ? 'on' : 'off'}" data-row="${i}">
      <label class="pc-tick"><input type="checkbox" ${r.enabled ? 'checked' : ''}><span class="m-${r.tc === 'prop' ? 'prop' : esc(r.mk)}" title="${esc(r.label)}">${esc(r.label)}</span>${kind}${tiers}</label>${num}</li>`;
  }

  // An item's picture as the game shows it: no frame, the sockets and their links drawn over it.
  // sockets: "R-R-G B" as the game writes them. w: how many cells wide the item is.
  const SOCKET_ORDER = { 1: [[0, 0], [0, 1], [0, 2], [0, 3]], 2: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 2], [1, 2]] };
  function socketsHtml(text, w) {
    if (!text) return '';
    const cols = w >= 2 ? 2 : 1;
    const list = [];
    for (const g of text.split(' ')) g.split('-').forEach((c, i) => list.push({ c: c.toLowerCase(), linked: i > 0 }));
    const order = SOCKET_ORDER[cols].slice(0, list.length);
    const rows = Math.max(...order.map((p) => p[1])) + 1;
    const at = new Map(order.map((p, i) => [`${p[0]},${p[1]}`, i]));
    let html = '';
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = at.get(`${x},${y}`);
      if (i === undefined) { html += '<i class="none"></i>'; continue; }
      let cls = `s-${list[i].c}`;
      const next = list[i + 1], to = order[i + 1];
      if (next && next.linked) { if (to[1] === y && to[0] === x + 1) cls += ' lr'; else if (to[1] === y + 1) cls += ' ld'; else if (to[1] === y && to[0] === x - 1) cls += ' ll'; }
      html += `<i class="${cls}"></i>`;
    }
    return `<span class="sk-grid c${cols}">${html}</span>`;
  }
  const art = (icon, sockets, w, h, size) => `<span class="pc-art ${size} w${Math.min(2, w || 1)} h${Math.min(4, h || 1)}">${icon ? `<img src="${esc(icon)}" alt="">` : ''}${socketsHtml(sockets, w)}</span>`;

  // A price with the picture of its currency (or its name when the picture is not known).
  function coin(id) {
    const url = data && data.coins && data.coins[id];
    return url ? `<img class="pc-coin" src="${esc(url)}" alt="${esc(COIN_WORDS[id] || id)}" title="${esc(COIN_WORDS[id] || id)}">` : `<span class="pc-cw">${esc(COIN_WORDS[id] || id)}</span>`;
  }
  // A value in chaos, shown in divines once it is worth one or more.
  function priceHtml(c, c2) {
    const divine = data ? data.divine : 0;
    const inDiv = divine > 0 && c >= divine;
    const f = (v) => { const x = inDiv ? v / divine : v; return x >= 100 ? Math.round(x).toLocaleString() : String(Math.round(x * (inDiv ? 100 : 10)) / (inDiv ? 100 : 10)); };
    const a = f(c), b = c2 != null ? f(c2) : a;
    return `<b>${a === b ? a : `${a}–${b}`}</b>${coin(inDiv ? 'divine' : 'chaos')}`;
  }

  // The answer, beside the picture: the cheapest and the typical price big, the rest in a line.
  function headlineHtml(d) {
    if (d.state === 'searching') return '<p class="pc-wait">Searching the trade site…</p>';
    if (d.state === 'error') return `<p class="pc-bad">${esc(d.error)}</p>`;
    const ninja = d.ninja !== null && d.ninja !== undefined ? `poe.ninja <b>${fmtValue(d.ninja)}</b>` : '';
    if (d.state !== 'done') return `<p class="pc-say">Tick what matters, then press Search.</p>${ninja ? `<p class="pc-sub">${ninja}</p>` : ''}`;
    if (!d.total) return `<p class="pc-say">Nothing like it is listed. Switch a stat off or lower a number.</p>${ninja ? `<p class="pc-sub">${ninja}</p>` : ''}`;
    const s = d.summary || {};
    const sub = [`<b>${d.total.toLocaleString()}</b> listed`, ninja, d.searchedAt ? `searched ${ago(d.searchedAt, true)}` : ''].filter(Boolean).join('<i>·</i>');
    if (s.low === null) return `<p class="pc-sub">${sub}</p>`;
    return `<div class="pc-price">${priceHtml(s.low, s.median)}<small>${s.low === s.median ? 'cheapest' : 'cheapest – typical'}</small></div><p class="pc-sub">${sub}</p>`;
  }

  // The listings, cheapest first: picture, price, seller, and the one number compared.
  function listHtml(d) {
    if (d.state !== 'done' || !d.listings.length) return '';
    const cmp = d.compare;
    const first = d.listings.find((l) => !l.bait);
    const rowsHtml = d.listings.map((l) => {
      const amount = l.price ? Math.round(l.price.amount * 100) / 100 : '';
      const price = l.price ? `<b>${amount}</b>${coin(l.price.currency)}` : '<span class="pc-cw">no price</span>';
      let vs = '';
      if (cmp && l.cmp !== null && l.cmp !== undefined) {
        const better = cmp.lower ? l.cmp < cmp.mine : l.cmp > cmp.mine, worse = cmp.lower ? l.cmp > cmp.mine : l.cmp < cmp.mine;
        vs = `<span class="pc-vs ${better ? 'up' : worse ? 'down' : ''}" title="${esc(cmp.label)}: ${l.cmp} (yours ${cmp.mine})">${l.cmp}</span>`;
      } else if (cmp) vs = '<span class="pc-vs">—</span>';
      return `<li class="${l.bait ? 'bait' : l === first ? 'first' : ''}">${art(l.icon, l.sockets, l.w, l.h, 'sm')}<span class="pc-lp">${price}</span>
        <span class="pc-who"><b>${esc(l.seller)}</b><small>${l.bait ? '<em>price looks like bait</em> · ' : ''}<i class="st ${esc(l.status)}"></i>${STATUS_WORDS[l.status] || ''}${l.listedAt ? ` · ${ago(l.listedAt)}` : ''}</small></span>${vs}</li>`;
    }).join('');
    const head = cmp ? `<span title="${esc(cmp.label)}">${esc(shortLabel(cmp.label))}: yours <b>${esc(cmp.mine)}</b></span>` : '';
    return `<div class="pc-listings"><div class="pc-lh"><span>Cheapest first</span>${head}</div><ul class="pc-list${cmp ? ' cmp' : ''}">${rowsHtml}</ul></div>`;
  }
  const shortLabel = (t) => { const s = String(t).replace(/^[+#%\s]+/, '').replace(/^total /i, ''); return s.length > 26 ? `${s.slice(0, 24)}…` : s; };

  function draw() {
    const d = data;
    if (!d || !d.filters || !d.filters.ok) { panel.innerHTML = ''; sendSize(0); return; }
    const key = `${d.at}:${d.filtersRev}`;
    if (key !== formFor) { formFor = key; rows = rowsFrom(d.filters); }
    // A new item: the window waits for its height before it shows, so it is always sent.
    if (modeFor !== d.at) { modeFor = d.at; mode = 'stats'; sentHeight = -1; }
    const f = d.filters;
    const tabs = f.presets ? `<div class="pc-tabs" role="tablist">
        <button type="button" role="tab" class="pc-tab${mode === 'stats' ? ' on' : ''}" aria-selected="${mode === 'stats'}" data-mode="stats" title="Items with stats like this one">Stats</button>
        <button type="button" role="tab" class="pc-tab${mode === 'base' ? ' on' : ''}" aria-selected="${mode === 'base'}" data-mode="base" title="This base type at this item level, whatever is rolled on it">Base item</button></div>` : '';
    const scroll = panel.querySelector('.pc-body') ? panel.querySelector('.pc-body').scrollTop : 0;
    const chips = rows.map((r, i) => (r.chip ? chipHtml(r, i) : '')).join('');
    const stats = rows.map((r, i) => (r.chip ? '' : rowHtml(r, i))).join('');
    const about = [f.type && f.name !== f.title ? f.type.value : (f.category ? f.category.label : ''), f.itemLevel ? `item level ${f.itemLevel}` : '', f.sockets ? `${Math.max(...f.sockets.split(' ').map((g) => g.split('-').length))} linked` : ''].filter(Boolean);
    panel.innerHTML = `<div class="pc-head">${art(d.icon, f.sockets, d.iconW || (f.sockets && f.sockets.replace(/[- ]/g, '').length > 4 ? 2 : 1), d.iconH || 3, 'big')}
        <div class="pc-meta"><h1>${esc(f.title)}</h1><p class="pc-about">${esc(about.join(' · '))}</p>${headlineHtml(d)}</div>
        <button type="button" class="pc-x" data-close aria-label="Close">×</button></div>
      ${tabs}
      <div class="pc-body"><div class="pc-chips">${chips}</div>
        ${stats ? `<ul class="pc-rows">${stats}</ul>` : ''}
        ${f.unknown.length ? `<p class="pc-note">Not on the trade site: ${f.unknown.map(esc).join('; ')}</p>` : ''}</div>
      <div class="pc-go"><button type="button" class="primary" data-search ${d.state === 'searching' ? 'disabled' : ''}>${d.state === 'done' ? 'Search again' : 'Search'}</button>
        ${d.url ? '<button type="button" class="pc-site" data-open>Trade site ↗</button>' : ''}</div>
      ${listHtml(d)}`;
    if (panel.querySelector('.pc-body')) panel.querySelector('.pc-body').scrollTop = scroll;
    sendSize(fullHeight());
  }
  // The window is only told its height when it changed: each change moves a see-through window,
  // which is slow on Windows.
  let sentHeight = -1;
  function sendSize(h) { if (h !== sentHeight) { sentHeight = h; api.checkSize(h); } }

  // How tall the panel wants to be. It is never taller than its window (so a long list scrolls
  // inside it), which means its height on screen says nothing while the window is still small:
  // the limit is lifted for the moment of measuring.
  function fullHeight() {
    panel.style.maxHeight = 'none';
    const h = Math.ceil(panel.getBoundingClientRect().height) + 2;
    panel.style.maxHeight = '';
    return h;
  }

  // What is ticked and set, in the shape the app lays over its own copy of the choices.
  function edits() {
    const e = { flags: {}, props: {}, stats: {} };
    for (const r of rows) {
      if (r.tc === 'offline' || r.tc === 'type' || r.tc === 'category') e[r.tc] = r.enabled;
      else if (r.tc === 'flag') e.flags[r.key] = r.enabled;
      else if (r.tc === 'prop') e.props[r.key] = { enabled: r.enabled, min: r.num };
      else if (r.tc === 'stat') e.stats[r.key] = r.bound ? { enabled: r.enabled, [r.bound]: r.num } : { enabled: r.enabled };
    }
    return e;
  }

  function nudge(row, dir) {
    if (!row || !row.bound || row.num === null) return;
    row.num = Math.round((Number(row.num) + (row.flip ? -dir : dir) * row.step) * 10) / 10;
    row.enabled = true; // setting a number means wanting it searched
    // Only the number and the tick change: the rest of the window stays as it is (no redraw, so
    // holding + or turning the wheel stays smooth).
    const li = panel.querySelector(`[data-row="${rows.indexOf(row)}"]`);
    if (!li) { draw(); return; }
    li.querySelector('.pc-num b').textContent = row.flip ? -row.num : row.num;
    setOn(li, true);
  }
  function setOn(el, on) {
    el.classList.toggle('on', on); el.classList.toggle('off', !on);
    const box = el.querySelector('input[type=checkbox]');
    if (box) box.checked = on;
    if (el.classList.contains('pc-chip')) el.setAttribute('aria-pressed', String(on));
  }

  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { api.action({ type: 'checkPanelClose' }); return; }
    if (e.target.closest('[data-search]')) { api.action({ type: 'tradeSearch', edits: edits() }); return; }
    if (e.target.closest('[data-open]')) { api.action({ type: 'tradeOpen' }); return; }
    const tab = e.target.closest('[data-mode]');
    if (tab && data.filters.presets) {
      // A ready-made search: its ticks replace the ones on screen. Numbers stay as set.
      mode = tab.dataset.mode;
      const set = data.filters.presets[mode] || {};
      for (const r of rows) if (r.pk in set) r.enabled = !!set[r.pk];
      draw();
      return;
    }
    const chip = e.target.closest('.pc-chip');
    if (chip) { const r = rows[Number(chip.dataset.row)]; r.enabled = !r.enabled; setOn(chip, r.enabled); return; }
    const li = e.target.closest('[data-row]');
    if (!li) return;
    const step = e.target.closest('[data-step]');
    if (step) nudge(rows[Number(li.dataset.row)], Number(step.dataset.step));
  });
  panel.addEventListener('change', (e) => {
    const li = e.target.closest('[data-row]');
    if (!li || e.target.type !== 'checkbox') return;
    rows[Number(li.dataset.row)].enabled = e.target.checked;
    setOn(li, e.target.checked);
  });
  // The wheel over a number moves it too.
  panel.addEventListener('wheel', (e) => {
    const num = e.target.closest('.pc-num');
    if (!num) return;
    e.preventDefault();
    nudge(rows[Number(num.closest('[data-row]').dataset.row)], e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  panel.addEventListener('load', () => sendSize(fullHeight()), true);

  // The app sends its state often; the window is only redrawn when this item's search has news,
  // so a click is never lost to a redraw in the middle of it.
  let shown = '';
  api.onCheck((d) => {
    const key = d && d.filters ? `${d.at}:${d.filtersRev}:${d.rev}:${Math.round(d.divine || 0)}` : '';
    data = d;
    if (key !== shown || !key) { shown = key; draw(); }
  });
})();
