'use strict';
// The price check window on top of the game: the answer in one line, the item's stats with
// tick boxes and a number to nudge with + and -, and what the trade site lists like it. The window never takes the
// keyboard (the game keeps it), so nothing here is typed: exact numbers and a highest value
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
  function ago(ts) {
    if (!ts) return '';
    const m = Math.max(0, Math.floor((Date.now() - ts) / 60000));
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
      out.push({ tc: 'stat', pk: `stat:${x.key}`, key: x.key, label: x.text, kind: KIND_WORDS[x.kind] || '', tiers: x.tiers || [], enabled: x.enabled, bound, num: bound ? x[bound] : null, step: stepFor(x.value), flip: !!x.negated });
    }
    return out;
  }

  const chipHtml = (r, i) => `<button type="button" class="pc-chip${r.enabled ? ' on' : ''}" data-row="${i}" aria-pressed="${r.enabled}"${r.title ? ` title="${esc(r.title)}"` : ''}>${esc(r.label)}</button>`;
  function rowHtml(r, i) {
    let num = '';
    if (r.bound && r.num !== null) {
      const word = (r.bound === 'min') !== r.flip ? 'min' : 'max';
      num = `<div class="pc-num"><i>${word}</i><button type="button" data-step="-1" aria-label="Lower">−</button><b>${esc(r.flip ? -r.num : r.num)}</b><button type="button" data-step="1" aria-label="Higher">+</button></div>`;
    }
    return `<li class="${r.enabled ? 'on' : 'off'}" data-row="${i}">
      <label class="pc-tick"><input type="checkbox" ${r.enabled ? 'checked' : ''}><span title="${esc(r.label)}">${esc(r.label)}</span>${(r.tiers || []).map((t) => `<small class="pc-tier${t === 1 ? ' best' : ''}" title="Tier ${t}: tier 1 is the best this modifier can be">T${t}</small>`).join('')}${r.kind ? `<small class="k-${r.kind}">${r.kind}</small>` : ''}</label>${num}</li>`;
  }

  // The answer in one line, right under the item's name.
  function headlineHtml(d) {
    if (d.state === 'searching') return '<p class="pc-wait">Searching the trade site…</p>';
    if (d.state === 'error') return `<p class="pc-bad">${esc(d.error)}</p>`;
    const ninja = d.ninja !== null && d.ninja !== undefined ? `<span class="pc-fig"><b>${fmtValue(d.ninja)}</b><i>poe.ninja</i></span>` : '';
    if (d.state !== 'done') return `<div class="pc-figs">${ninja}<span class="pc-say">Tick what matters, then press Search.</span></div>`;
    if (!d.total) return `<div class="pc-figs">${ninja}<span class="pc-say">Nothing like it is listed. Switch a stat off or lower a number.</span></div>`;
    const s = d.summary || {};
    if (s.low === null) return `<div class="pc-figs">${ninja}<span class="pc-fig"><b>${d.total.toLocaleString()}</b><i>listed</i></span></div>`;
    return `<div class="pc-figs"><span class="pc-fig main"><b>${fmtValue(s.low)}</b><i>cheapest</i></span><span class="pc-fig"><b>${fmtValue(s.median)}</b><i>typical</i></span>
      <span class="pc-fig"><b>${d.total.toLocaleString()}</b><i>listed</i></span>${ninja}</div>`;
  }

  function listHtml(d) {
    if (d.state !== 'done' || !d.listings.length) return '';
    const rowsHtml = d.listings.map((l) => {
      const amount = l.price ? Math.round(l.price.amount * 100) / 100 : '';
      const coin = l.price ? esc(COIN_WORDS[l.price.currency] || l.price.currency) : 'no price';
      const about = l.price && l.price.currency !== 'chaos' && l.chaos !== null ? `${Math.round(l.chaos).toLocaleString()}c` : '';
      return `<li><span class="pc-price"><b>${amount}</b> ${coin}</span><span class="pc-about">${about}</span><span class="pc-age">${ago(l.listedAt)}</span>
        <span class="pc-st ${esc(l.status)}">${STATUS_WORDS[l.status] || ''}</span><span class="pc-seller">${esc(l.seller)}</span></li>`;
    }).join('');
    return `<div class="pc-listings"><div class="pc-cols"><span class="pc-price">Price</span><span class="pc-about"></span><span class="pc-age">Listed</span><span class="pc-st">Seller</span><span class="pc-seller"></span></div>
      <ul class="pc-list">${rowsHtml}</ul></div>`;
  }

  function draw() {
    const d = data;
    if (!d || !d.filters || !d.filters.ok) { panel.innerHTML = ''; api.checkSize(0); return; }
    const key = `${d.at}:${d.filtersRev}`;
    if (key !== formFor) { formFor = key; rows = rowsFrom(d.filters); }
    if (modeFor !== d.at) { modeFor = d.at; mode = 'stats'; }
    const f = d.filters;
    const tabs = f.presets ? `<div class="pc-tabs" role="tablist">
        <button type="button" role="tab" class="pc-tab${mode === 'stats' ? ' on' : ''}" aria-selected="${mode === 'stats'}" data-mode="stats" title="Items with stats like this one">Stats</button>
        <button type="button" role="tab" class="pc-tab${mode === 'base' ? ' on' : ''}" aria-selected="${mode === 'base'}" data-mode="base" title="This base type at this item level, whatever is rolled on it">Base item</button></div>` : '';
    const scroll = panel.querySelector('.pc-body') ? panel.querySelector('.pc-body').scrollTop : 0;
    const chips = rows.map((r, i) => (r.chip ? chipHtml(r, i) : '')).join('');
    const stats = rows.map((r, i) => (r.chip ? '' : rowHtml(r, i))).join('');
    panel.innerHTML = `<div class="pc-head"><h1>${esc(f.title)}</h1><button type="button" class="pc-x" data-close aria-label="Close">×</button></div>
      <div class="pc-headline">${headlineHtml(d)}</div>
      ${tabs}
      <div class="pc-body"><div class="pc-chips">${chips}</div>
        ${stats ? `<ul class="pc-rows">${stats}</ul>` : ''}
        ${f.unknown.length ? `<p class="pc-note">Not on the trade site: ${f.unknown.map(esc).join('; ')}</p>` : ''}</div>
      <div class="pc-go"><button type="button" class="primary" data-search ${d.state === 'searching' ? 'disabled' : ''}>Search</button>
        ${d.url ? '<button type="button" class="link" data-open>Open on the trade site</button>' : ''}</div>
      ${listHtml(d)}`;
    if (panel.querySelector('.pc-body')) panel.querySelector('.pc-body').scrollTop = scroll;
    api.checkSize(fullHeight());
  }

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
    draw();
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
    if (chip) { const r = rows[Number(chip.dataset.row)]; r.enabled = !r.enabled; draw(); return; }
    const li = e.target.closest('[data-row]');
    if (!li) return;
    const step = e.target.closest('[data-step]');
    if (step) nudge(rows[Number(li.dataset.row)], Number(step.dataset.step));
  });
  panel.addEventListener('change', (e) => {
    const li = e.target.closest('[data-row]');
    if (!li || e.target.type !== 'checkbox') return;
    rows[Number(li.dataset.row)].enabled = e.target.checked;
    draw();
  });
  // The wheel over a number moves it too.
  panel.addEventListener('wheel', (e) => {
    const num = e.target.closest('.pc-num');
    if (!num) return;
    e.preventDefault();
    nudge(rows[Number(num.closest('[data-row]').dataset.row)], e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  // The app sends its state often; the window is only redrawn when this item's search has news,
  // so a click is never lost to a redraw in the middle of it.
  let shown = '';
  api.onCheck((d) => {
    const key = d && d.filters ? `${d.at}:${d.filtersRev}:${d.rev}:${Math.round(d.divine || 0)}` : '';
    data = d;
    if (key !== shown || !key) { shown = key; draw(); }
  });
})();
