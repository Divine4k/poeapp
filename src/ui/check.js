'use strict';
// The price check window on top of the game: the item's stats with tick boxes, a number to
// nudge with + and -, and what the trade site lists like it. The window never takes the
// keyboard (the game keeps it), so nothing here is typed: exact numbers and a highest value
// can be set on the app's Prices page, which shows the same search.
(() => {
  const api = window.api;
  const panel = document.getElementById('panel');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KIND_WORDS = { pseudo: 'total', implicit: 'implicit', crafted: 'crafted', fractured: 'fractured', enchant: 'enchant', scourge: 'scourge', crucible: 'crucible' };
  const COIN_WORDS = { chaos: 'c', divine: 'div', exalted: 'ex', mirror: 'mirror' };
  const STATUS_WORDS = { instant: 'Instant buyout', online: 'Online', afk: 'Away', offline: 'Offline' };

  let data = null;
  let rows = [];     // what is ticked and set right now
  let formFor = '';  // which item and which round of choices the rows belong to

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
    if (f.category) out.push({ tc: 'category', label: `Kind: ${f.category.label}, any base type`, enabled: f.category.enabled });
    if (f.type) out.push({ tc: 'type', label: `Base type: ${f.type.value}`, enabled: f.type.enabled });
    for (const x of f.flags) out.push({ tc: 'flag', key: x.key, label: x.label, enabled: x.enabled });
    for (const x of f.props) out.push({ tc: 'prop', key: x.key, label: `${x.label}: ${x.value}`, enabled: x.enabled, bound: 'min', num: x.min === null ? x.value : x.min, step: stepFor(x.value) });
    for (const x of f.stats) {
      // The number shown is the one the search asks for: "at least" for most stats, "at most"
      // where less is better.
      const bound = x.value === null ? null : (x.min === null && x.max !== null ? 'max' : 'min');
      out.push({ tc: 'stat', key: x.key, label: x.text, kind: KIND_WORDS[x.kind] || '', enabled: x.enabled, bound, num: bound ? x[bound] : null, step: stepFor(x.value), min: x.min, max: x.max });
    }
    out.push({ tc: 'offline', label: 'Also sellers who are offline', enabled: f.offline });
    return out;
  }

  const rowHtml = (r, i) => `<li class="${r.enabled ? '' : 'off'}" data-row="${i}">
    <label class="pc-tick"><input type="checkbox" ${r.enabled ? 'checked' : ''}><span title="${esc(r.label)}">${esc(r.label)}${r.kind ? `<small>${r.kind}</small>` : ''}</span></label>
    ${r.bound && r.num !== null ? `<div class="pc-num"><i>${r.bound === 'min' ? 'at least' : 'at most'}</i><b>${esc(r.num)}</b><button type="button" data-step="-1" aria-label="Lower">−</button><button type="button" data-step="1" aria-label="Higher">+</button></div>` : ''}</li>`;

  function resultHtml(d) {
    if (d.state === 'searching') return '<p class="dim">Searching the trade site…</p>';
    if (d.state === 'error') return `<p class="bad">${esc(d.error)}</p>`;
    if (d.state !== 'done') return `<p class="dim">${d.ninja !== null && d.ninja !== undefined ? `poe.ninja: <b>${fmtValue(d.ninja)}</b>. ` : ''}Tick what matters, then press Search.</p>`;
    if (!d.total) return '<p>Nothing like it is listed. Untick a stat or lower a number.</p>';
    const s = d.summary || {};
    const head = s.low === null ? `${d.total.toLocaleString()} listed.` : `${d.total.toLocaleString()} listed, from <b>${fmtValue(s.low)}</b>. Middle of the cheapest ${d.listings.length}: <b>${fmtValue(s.median)}</b>.`;
    const list = d.listings.map((l) => {
      const price = l.price ? `${l.price.amount} ${esc(COIN_WORDS[l.price.currency] || l.price.currency)}` : 'No price';
      const whisper = l.whisper && l.status !== 'instant' ? `<button type="button" data-whisper="${esc(l.id)}">Whisper</button>` : '<span class="gap"></span>';
      return `<li><span class="pc-price">${price}</span><span class="pc-seller">${esc(l.seller)}${l.itemLevel ? ` <span class="pc-st">ilvl ${l.itemLevel}</span>` : ''}</span>
        <span class="pc-st ${esc(l.status)}">${STATUS_WORDS[l.status] || ''}</span><span class="pc-age">${ago(l.listedAt)}</span>${whisper}</li>`;
    }).join('');
    return `<p class="pc-sum">${head}</p><ul class="pc-list">${list}</ul>`;
  }

  function draw() {
    const d = data;
    if (!d || !d.filters || !d.filters.ok) { panel.innerHTML = ''; api.checkSize(0); return; }
    const key = `${d.at}:${d.filtersRev}`;
    if (key !== formFor) { formFor = key; rows = rowsFrom(d.filters); }
    const f = d.filters;
    const scroll = panel.querySelector('.pc-body') ? panel.querySelector('.pc-body').scrollTop : 0;
    panel.innerHTML = `<div class="pc-head"><h1>${esc(f.title)}${f.unknown.length ? `<small>Not searchable: ${f.unknown.map(esc).join('; ')}</small>` : ''}</h1>
        <button type="button" class="pc-x" data-close aria-label="Close">×</button></div>
      <div class="pc-body"><ul class="pc-rows">${rows.map(rowHtml).join('')}</ul></div>
      <div class="pc-go"><button type="button" class="primary" data-search ${d.state === 'searching' ? 'disabled' : ''}>Search</button>
        <span>Exact numbers: Prices page</span>${d.url ? '<button type="button" class="link" data-open>Open on the trade site</button>' : ''}</div>
      <div class="pc-result">${resultHtml(d)}</div>`;
    if (panel.querySelector('.pc-body')) panel.querySelector('.pc-body').scrollTop = scroll;
    api.checkSize(Math.ceil(panel.getBoundingClientRect().height) + 2);
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
    row.num = Math.round((Number(row.num) + dir * row.step) * 10) / 10;
    draw();
  }

  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { api.action({ type: 'checkPanelClose' }); return; }
    if (e.target.closest('[data-search]')) { api.action({ type: 'tradeSearch', edits: edits() }); return; }
    if (e.target.closest('[data-open]')) { api.action({ type: 'tradeOpen' }); return; }
    const w = e.target.closest('[data-whisper]');
    if (w) { api.action({ type: 'tradeWhisper', id: w.dataset.whisper }); return; }
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
