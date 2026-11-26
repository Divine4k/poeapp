'use strict';
// Map check, costs, price check, and the trade site search for the item last checked.
// Part of the main window script: all files in src/ui/app/ share one scope, loaded in the order of index.html.

// ---- tools ----------------------------------------------------------------------
function renderMapCheck() {
  const mc = state.mapCheck, hk = state.config.hotkeys;
  const rules = state.config.mapRules || [];
  const anyRule = rules.some((r) => r.enabled);
  // The mods your build cannot run are ticked right here, beside the verdict they decide.
  const ticking = $('rules').contains(document.activeElement) ? document.activeElement.dataset.rule : null;
  setHtml($('rules'), rules.map((r) => `<label><input type="checkbox" data-rule="${esc(r.id)}"${r.enabled ? ' checked' : ''}> ${esc(r.label)}</label>`).join(''));
  if (ticking && !$('rules').contains(document.activeElement)) { const again = $('rules').querySelector(`[data-rule="${ticking}"]`); if (again) again.focus(); }
  let html;
  if (!mc) {
    html = `<p class="hint">Hover a map in game and press ${esc(hk.clipboard)}. The mods your build cannot run are flagged here.</p>
        ${anyRule ? '' : '<p class="notice">No mods are ticked yet, so every map counts as safe. Tick the ones your build cannot run.</p>'}
        <button type="button" data-act="readClipboard">Check the copied item now</button>`;
  } else {
    const stats = [mc.tier ? `Tier ${mc.tier}` : '', mc.quantity != null ? `${mc.quantity}% atlas drops` : '', mc.packSize != null ? `${mc.packSize}% pack size` : '', mc.corrupted ? 'corrupted' : '']
      .filter(Boolean).join(', ');
    const verdict = mc.unidentified ? '<div class="verdict danger">Unidentified: mods are hidden</div>'
      : mc.dangerCount ? `<div class="verdict danger">Do not run: ${mc.dangerCount} dangerous ${mc.dangerCount === 1 ? 'mod' : 'mods'}</div>`
        : `<div class="verdict safe">${anyRule ? 'Safe to run' : 'No mods are ticked as dangerous'}</div>`;
    html = `${verdict}<div class="map-meta">${esc(mc.name)}${stats ? `. ${esc(stats)}` : ''}</div>
        <ul class="mods">${mc.mods.map((m) => `<li class="${m.dangerous ? 'danger' : ''}">${esc(m.mod)}${m.dangerous ? `<small>${esc(m.labels.join(', '))}</small>` : ''}</li>`).join('')}</ul>`;
  }
  setHtml($('mapcheck-body'), html);
}
$('rules').addEventListener('change', () => {
  const on = new Set([...$('rules').querySelectorAll('[data-rule]')].filter((x) => x.checked).map((x) => x.dataset.rule));
  api.setConfig({ mapRules: state.config.mapRules.map((r) => ({ ...r, enabled: on.has(r.id) })) });
});

function costRow(c, attrs) {
  const fixed = c.chaos != null && c.chaos !== '';
  const each = c.each != null ? c.each : (fixed ? Number(c.chaos) : null);
  const val = each == null ? '' : (each > 0 || fixed ? fmtValue(each * (c.qty || 1)) : 'no price');
  return `<li><span>${esc(c.name)} ×${c.qty || 1}</span><span class="val">${val}</span>
      <button type="button" class="link" ${attrs} aria-label="Remove ${esc(c.name)}">Remove</button></li>`;
}
function renderCosts() {
  const lo = state.config.loadout || [];
  setHtml($('loadout'), lo.length ? lo.map((c, i) => costRow(c, `data-loadout="${i}"`)).join('')
    : '<li class="empty">Add what you put into each map (scarabs, the map, chisels) to see net profit.</li>');
  const run = currentRun();
  setHtml($('run-costs'), run && run.costs.length
    ? run.costs.map((c) => costRow(c, `data-act="removeCost" data-run="${esc(run.id)}" data-cost="${esc(c.id)}"`)).join('')
    : `<li class="empty">${run ? 'No costs on this map.' : 'No map is running.'}</li>`);
}

function renderPriceCheck() {
  const pc = state.priceCheck;
  if (!pc) { setHtml($('price-check'), ''); return; }
  if (pc.error) { setHtml($('price-check'), `<p class="notice bad">${esc(pc.error)}</p>`); return; }
  // Gear has no poe.ninja price; the trade search below answers for it.
  if (!pc.found && state.tradeCheck) { setHtml($('price-check'), ''); return; }
  // A price that was found is not repeated here: the result over the game already said it.
  setHtml($('price-check'), pc.found ? '' : `<p class="notice bad">No price found for ${esc(pc.name)}.</p>`);
}

// ---- trade site search for the item last checked ---------------------------------------
const KIND_WORDS = { pseudo: 'total', implicit: 'implicit', corruption: 'corruption', crafted: 'crafted', fractured: 'fractured', enchant: 'enchant', scourge: 'scourge', crucible: 'crucible' };
const COIN_WORDS = { chaos: 'c', divine: 'div', exalted: 'ex', mirror: 'mirror' };
const STATUS_WORDS = { instant: 'Instant buyout', online: 'Online', afk: 'Away', offline: 'Offline' };
const numAttr = (v) => (v === null || v === undefined ? '' : esc(v));
function ago(ts) {
  if (!ts) return '';
  const m = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.floor(m / 60)} h`;
  return `${Math.floor(m / 1440)} d`;
}
let tradeFormFor = ''; // which check, and which round of its choices, the tick boxes on screen belong to
let tradeRevShown = -1;

function tradeFormHtml(f) {
  const tick = (attrs, label, on) => `<label class="tc-tick"><input type="checkbox" ${attrs} ${on ? 'checked' : ''}> <span>${label}</span></label>`;
  const rows = [];
  if (f.category) rows.push(`<li>${tick('data-tc="category"', `Kind: ${esc(f.category.label)}, any base type`, f.category.enabled)}</li>`);
  if (f.type) rows.push(`<li>${tick('data-tc="type"', `Base type: ${esc(f.type.value)}`, f.type.enabled)}</li>`);
  for (const x of f.flags) rows.push(`<li>${tick(`data-tc="flag" data-key="${esc(x.key)}"`, esc(x.label), x.enabled)}</li>`);
  for (const x of f.props) {
    rows.push(`<li>${tick(`data-tc="prop" data-key="${esc(x.key)}"`, `${esc(x.label)}: ${x.value}${x.unit || ''}`, x.enabled)}
        <input type="number" step="any" data-tc-min="${esc(x.key)}" value="${numAttr(x.min)}" placeholder="min" aria-label="Lowest ${esc(x.label)}"></li>`);
  }
  for (const x of f.stats) {
    const kind = (x.tiers || []).map((t) => `<small class="tier${t === 1 ? ' best' : ''}" title="Tier 1 is the best this modifier can be">Tier ${t}</small>`).join('')
      + (KIND_WORDS[x.kind] ? `<small>${KIND_WORDS[x.kind]}</small>` : '');
    const range = x.value === null ? '' : `<input type="number" step="any" data-tc-min="${esc(x.key)}" value="${numAttr(x.min)}" placeholder="min" aria-label="Lowest value for ${esc(x.text)}">
        <input type="number" step="any" data-tc-max="${esc(x.key)}" value="${numAttr(x.max)}" placeholder="max" aria-label="Highest value for ${esc(x.text)}">`;
    rows.push(`<li>${tick(`data-tc="stat" data-key="${esc(x.key)}"`, `${esc(x.text)} ${kind}`, x.enabled)}${range}</li>`);
  }
  rows.push(`<li>${tick('data-tc="offline"', 'Also sellers who are offline', f.offline)}</li>`);
  const unknown = f.unknown.length ? `<p class="hint small">Not searchable on the trade site: ${f.unknown.map(esc).join('; ')}</p>` : '';
  // Two ready-made searches: by the item's stats, or for its base to craft on.
  const modes = f.presets ? `<div class="tc-modes" role="group" aria-label="Ready-made searches"><button type="button" data-tc-mode="stats" aria-pressed="true">Stats</button>
      <button type="button" data-tc-mode="base" aria-pressed="false" title="This base type at this item level, whatever is rolled on it">Base item</button></div>` : '';
  return `${modes}<ul class="tc-rows">${rows.join('')}</ul>${unknown}`;
}

function tradeResultHtml(tc) {
  if (tc.state === 'searching') return '<p class="hint">Searching the trade site…</p>';
  if (tc.state === 'error') return `<p class="notice bad">${esc(tc.error)}</p>`;
  if (tc.state !== 'done') return '<p class="hint">Tick what matters about this item, then press Search. Each search is two requests to the trade site, which allows only a few per minute.</p>';
  const link = tc.url ? `<a href="${esc(tc.url)}" target="_blank" rel="noreferrer">Open this search on the trade site</a>` : '';
  if (!tc.total) return `<p class="notice">Nothing like it is listed. Untick a stat or lower a number to widen the search.</p>${link}`;
  const s = tc.summary || {};
  const head = s.low === null ? `${tc.total.toLocaleString()} listed.`
    : `Cheapest <b>${fmtValue(s.low)}</b>, typical <b>${fmtValue(s.median)}</b>. ${tc.total.toLocaleString()} listed.`;
  const rowsHtml = tc.listings.map((l) => {
    const price = l.price ? `${l.price.amount} ${esc(COIN_WORDS[l.price.currency] || l.price.currency)}` : 'No price';
    const inChaos = l.price && l.price.currency !== 'chaos' && l.chaos !== null ? `<small>about ${Math.round(l.chaos).toLocaleString()}c</small>` : '';
    return `<tr><td class="num val">${price}${inChaos}</td>
        <td>${esc(l.name)}${l.itemLevel ? `<small>Item level ${l.itemLevel}${l.corrupted ? ', corrupted' : ''}</small>` : ''}</td>
        <td>${esc(l.seller)}<small class="st-${esc(l.status)}">${STATUS_WORDS[l.status] || ''}</small></td>
        <td class="num dim">${ago(l.listedAt)}</td></tr>`;
  }).join('');
  return `<p class="tc-sum">${head} ${link}</p>
      <div class="table-wrap"><table class="tc-list"><thead><tr><th class="num">Price</th><th>Item</th><th>Seller</th><th class="num">Listed</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
}

function renderTradeCheck() {
  const tc = state.tradeCheck && state.tradeCheck.kind !== 'bulk' ? state.tradeCheck : null, box = $('trade-check'); // currency stays a line on the price lists
  document.querySelector('#tab-prices .prices').hidden = !!tc;
  $('price-global').hidden = !!tc;
  box.hidden = !tc;
  if (!tc) { tradeFormFor = ''; tradeRevShown = -1; box.innerHTML = ''; return; }
  if (tradeFormFor !== `${tc.at}:${tc.filtersRev}`) {
    // A new item, or a search sent from the window in game: draw the tick boxes. Other
    // updates only touch the results, so what you ticked and typed stays as it is.
    tradeFormFor = `${tc.at}:${tc.filtersRev}`; tradeRevShown = -1;
    const f = tc.filters;
    box.innerHTML = `<div class="tc-head"><h2 class="pagetitle">${esc(f.ok ? f.title : 'Trade search')}</h2>
          <button type="button" data-act="tradeClose">Back to the price lists</button></div>
        ${f.ok ? `<div class="tc-cols"><form id="tc-form" autocomplete="off"><h3>Search for</h3>${tradeFormHtml(f)}
            <div class="tc-go"><button type="submit" class="primary" id="tc-search">Search</button></div>
          </form><section id="tc-result" aria-live="polite"></section></div>`
  : `<p class="notice">${esc(f.why)}</p>`}`;
  }
  if (tc.filters.ok && tradeRevShown !== tc.rev) {
    tradeRevShown = tc.rev;
    $('tc-result').innerHTML = `<h3>Listed on the trade site</h3>${tradeResultHtml(tc)}`;
    $('tc-search').disabled = tc.state === 'searching';
  }
}

// What is ticked and typed in the search form, for the main process to lay over its own copy.
function tradeEdits(form) {
  const edits = { flags: {}, props: {}, stats: {} };
  const val = (sel) => { const i = form.querySelector(sel); return i ? i.value : undefined; };
  for (const c of form.querySelectorAll('[data-tc]')) {
    const key = c.dataset.key;
    if (c.dataset.tc === 'offline' || c.dataset.tc === 'type' || c.dataset.tc === 'category') edits[c.dataset.tc] = c.checked;
    else if (c.dataset.tc === 'flag') edits.flags[key] = c.checked;
    else if (c.dataset.tc === 'prop') edits.props[key] = { enabled: c.checked, min: val(`[data-tc-min="${key}"]`) };
    else if (c.dataset.tc === 'stat') {
      const e = { enabled: c.checked }, min = val(`[data-tc-min="${key}"]`), max = val(`[data-tc-max="${key}"]`);
      if (min !== undefined) e.min = min;
      if (max !== undefined) e.max = max;
      edits.stats[key] = e;
    }
  }
  return edits;
}
$('trade-check').addEventListener('submit', (e) => {
  e.preventDefault();
  act({ type: 'tradeSearch', edits: tradeEdits(e.target) });
});
$('trade-check').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tc-mode]');
  const tc = state.tradeCheck;
  if (!b || !tc || !tc.filters.presets) return;
  const set = tc.filters.presets[b.dataset.tcMode] || {};
  for (const c of $('tc-form').querySelectorAll('[data-tc]')) {
    const name = c.dataset.tc === 'flag' || c.dataset.tc === 'prop' || c.dataset.tc === 'stat' ? `${c.dataset.tc}:${c.dataset.key}` : c.dataset.tc;
    if (name in set) c.checked = !!set[name];
  }
  for (const x of $('tc-form').querySelectorAll('[data-tc-mode]')) x.setAttribute('aria-pressed', String(x === b));
});
